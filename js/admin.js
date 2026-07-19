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
      <td><strong>${c.name}</strong></td>
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
        <td><strong>${c.name}</strong></td>
        <td>
          <div class="input-prefix" style="max-width:220px">
            <span>₹</span>
            <input type="text" class="limit-input" data-cat="${c.id}"
                   value="${existing}" placeholder="No limit"
                   inputmode="decimal" style="font-variant-numeric:tabular-nums">
          </div>
        </td>
        <td style="text-align:center">
          ${limitMap[c.id] !== undefined
            ? `<button class="btn btn-danger-ghost btn-sm" onclick="removeLimit(${c.id})">Remove</button>`
            : '<span style="color:var(--text-3);font-size:.8rem">—</span>'
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
function loadGoal() {
  const goal = DB.getGeneralGoal();
  const inp  = document.getElementById('goal-amount');
  inp.value = goal
    ? parseFloat(goal).toLocaleString('en-IN', { maximumFractionDigits: 2 })
    : '';
}

function setupGoalInput() {
  const inp = document.getElementById('goal-amount');
  setupAmountInput(inp);
}

document.getElementById('save-goal-btn').addEventListener('click', () => {
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
  DB.setGeneralGoal(val);
  showToast('Budget goal saved ✅');
  loadGoal();
});

document.getElementById('clear-goal-btn').addEventListener('click', () => {
  DB.setGeneralGoal(null);
  document.getElementById('goal-amount').value = '';
  document.getElementById('goal-err').classList.remove('visible');
  showToast('Budget goal cleared');
});

/* ── Init ──────────────────────────────────────────────────────────── */
loadCategories();
loadLimits();
loadGoal();
setupGoalInput();
