/* dashboard.js */
let allCategories = [];

function init() {
  populateYears();
  setDefaultFilters();
  loadCategories();
  loadAll();
}

function populateYears() {
  const sel = document.getElementById('f-year');
  const now = new Date().getFullYear();
  sel.innerHTML = '<option value="">All Years</option>';
  for (let y = now + 1; y >= now - 5; y--) {
    sel.innerHTML += `<option value="${y}" ${y === now ? 'selected' : ''}>${y}</option>`;
  }
}

function setDefaultFilters() {
  document.getElementById('f-month').value = new Date().getMonth() + 1;
}

function loadCategories() {
  allCategories = DB.getAllCategories();
  const opt = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('f-category').innerHTML = '<option value="">All Categories</option>' + opt;
  document.getElementById('edit-cat').innerHTML = opt;
}

function getFilters() {
  return {
    year:     document.getElementById('f-year').value,
    month:    document.getElementById('f-month').value,
    from:     document.getElementById('f-from').value,
    to:       document.getElementById('f-to').value,
    category: document.getElementById('f-category').value
  };
}

function loadAll() {
  const filters = getFilters();
  renderSummary(DB.getSummary(filters));
  renderTable(DB.getExpenditures(filters));
}

/* ── Summary cards ──────────────────────────────────────────────────── */
function renderSummary(rows) {
  const grid = document.getElementById('summary-grid');
  const withSpend = rows.filter(r => r.total > 0);
  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  if (!withSpend.length && grandTotal === 0) {
    grid.innerHTML = `<div class="summary-card" style="grid-column:1/-1"><div class="empty"><div class="empty-icon">💳</div><div class="empty-text">No transactions in this period</div></div></div>`;
    return;
  }

  const cards = withSpend.map(row => {
    let statusClass = '', progressHtml = '';
    if (row.monthly_limit) {
      const pct = Math.min(150, (row.total / row.monthly_limit) * 100);
      const fillClass = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
      statusClass = fillClass;
      const warnMsg = pct >= 100
        ? `<div class="sc-warning">⚠️ Over limit by ₹${formatINR(row.total - row.monthly_limit)}</div>`
        : '';
      progressHtml = `
        <div class="sc-limit">Monthly Limit: ₹${formatINR(row.monthly_limit, 0)} &nbsp;·&nbsp; ${Math.round((row.total / row.monthly_limit) * 100)}% used</div>
        ${warnMsg}
        <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${Math.min(100, pct)}%"></div></div>`;
    } else {
      progressHtml = `<div class="sc-limit text-muted">No limit set</div>`;
    }
    return `
      <div class="summary-card ${statusClass}">
        <div class="sc-label">${row.category_name}</div>
        <div class="sc-amount">₹${formatINR(row.total)}</div>
        ${progressHtml}
      </div>`;
  }).join('');

  const totalCard = `
    <div class="summary-card total">
      <div class="sc-label">Grand Total</div>
      <div class="sc-amount">₹${formatINR(grandTotal)}</div>
      <div class="sc-limit">${withSpend.length} categor${withSpend.length === 1 ? 'y' : 'ies'}</div>
    </div>`;

  grid.innerHTML = cards + totalCard;
}

/* ── Transactions table ─────────────────────────────────────────────── */
function renderTable(rows) {
  const tbody  = document.getElementById('exp-tbody');
  const totalEl = document.getElementById('exp-total');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-icon">🧾</div><div class="empty-text">No transactions found for this filter</div></div></td></tr>`;
    totalEl.textContent = '₹0.00';
    return;
  }

  const total = rows.reduce((s, r) => s + r.amount, 0);
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="white-space:nowrap">${formatDate(r.date)}</td>
      <td><span class="badge badge-cat">${r.category_name}</span></td>
      <td class="amount-col">₹${formatINR(r.amount)}</td>
      <td class="hide-sm" style="color:var(--text-3);font-size:.875rem">${r.notes || '—'}</td>
      <td style="text-align:center;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEdit(${r.id})">Edit</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="deleteEntry(${r.id})">Delete</button>
      </td>
    </tr>`).join('');
  totalEl.textContent = '₹' + formatINR(total);
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
setupAmountInput(document.getElementById('edit-amount'));

/* ── Filter controls ────────────────────────────────────────────────── */
document.getElementById('btn-apply').addEventListener('click', loadAll);
document.getElementById('btn-clear').addEventListener('click', () => {
  document.getElementById('f-from').value = '';
  document.getElementById('f-to').value   = '';
  document.getElementById('f-category').value = '';
  setDefaultFilters();
  populateYears();
  loadAll();
});

/* ── Excel export ───────────────────────────────────────────────────── */
document.getElementById('btn-export').addEventListener('click', () => {
  try {
    DB.exportToExcel();
    showToast('Exported to finance.xlsx ✅');
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
