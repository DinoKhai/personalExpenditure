const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const incomePager = { page: 1, size: 10 };

function openMonthTransactions(year, month) {
  const url = `index.html?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&openSummary=1`;
  window.location.href = url;
}

function toggleIncomeRow(el, key) {
  const detail = document.getElementById(`income-expand-${key}`);
  if (!detail) return;
  const isOpen = detail.classList.toggle('open');
  el.classList.toggle('income-row-open', isOpen);
}

function renderIncomeLog() {
  const rows = DB.getMonthlyCashLog();
  const tbody = document.getElementById('income-log-tbody');
  const pagerEl = document.getElementById('income-log-pager');
  const pages = Math.max(1, Math.ceil(rows.length / incomePager.size));
  incomePager.page = Math.min(Math.max(1, incomePager.page), pages);
  const start = (incomePager.page - 1) * incomePager.size;
  const pageRows = rows.slice(start, start + incomePager.size);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-icon">📒</div><div class="empty-text">No monthly log yet</div></div></td></tr>`;
    pagerEl.innerHTML = '';
    return;
  }
  tbody.innerHTML = pageRows.map(r => {
    const hasTransactions = Number(r.transactions_total) > 0;
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    return `
      <tr class="income-row" onclick="toggleIncomeRow(this,'${key}')">
        <td class="income-col-year">${r.year}</td>
        <td>${MONTHS[r.month - 1]}</td>
        <td class="amount-col">${r.income > 0 ? `₹${formatINR(r.income)}` : '<span class="text-muted">—</span>'}</td>
        <td class="amount-col">
          ${hasTransactions
            ? `<button class="btn btn-ghost btn-sm tx-drilldown-btn" onclick="event.stopPropagation();openMonthTransactions(${r.year},${r.month})">₹${formatINR(r.transactions_total)}</button>`
            : '<span class="text-muted">₹0.00</span>'}
        </td>
        <td class="amount-col income-col-net">${r.net >= 0 ? '+' : '-'}₹${formatINR(Math.abs(r.net))}</td>
      </tr>
      <tr class="income-expand" id="income-expand-${key}">
        <td colspan="5">
          <div class="income-expand-inner">
            <div class="income-expand-meta">
              <span><strong>Year:</strong> ${r.year}</span>
              <span><strong>Net:</strong> ${r.net >= 0 ? '+' : '-'}₹${formatINR(Math.abs(r.net))}</span>
            </div>
            ${hasTransactions
              ? `<button class="btn btn-ghost btn-sm tx-drilldown-btn" onclick="openMonthTransactions(${r.year},${r.month})">Open Month KPI</button>`
              : '<span class="text-muted">No debit transactions in this month</span>'}
          </div>
        </td>
      </tr>`;
  }).join('');
  const from = start + 1;
  const to = Math.min(rows.length, start + incomePager.size);
  pagerEl.innerHTML = `
    <div class="pager-bar">
      <div class="pager-top">
        <div class="pager-meta">Showing ${from}-${to} of ${rows.length}</div>
        <div class="pager-rows">
          <label>rows</label>
          <select id="income-pager-size">
            ${[5, 10, 20, 50].map(n => `<option value="${n}" ${n === incomePager.size ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="pager-nav">
        <button class="btn btn-ghost btn-sm" id="income-pager-first" ${incomePager.page <= 1 ? 'disabled' : ''} title="First page">«</button>
        <button class="btn btn-ghost btn-sm" id="income-pager-prev" ${incomePager.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="pager-page">${incomePager.page}/${pages}</span>
        <button class="btn btn-ghost btn-sm" id="income-pager-next" ${incomePager.page >= pages ? 'disabled' : ''}>Next</button>
        <button class="btn btn-ghost btn-sm" id="income-pager-last" ${incomePager.page >= pages ? 'disabled' : ''} title="Last page">»</button>
      </div>
    </div>`;
  document.getElementById('income-pager-size').addEventListener('change', e => {
    incomePager.size = Number(e.target.value) || 10;
    incomePager.page = 1;
    renderIncomeLog();
  });
  document.getElementById('income-pager-first').addEventListener('click', () => {
    if (incomePager.page <= 1) return;
    incomePager.page = 1;
    renderIncomeLog();
  });
  document.getElementById('income-pager-prev').addEventListener('click', () => {
    if (incomePager.page <= 1) return;
    incomePager.page -= 1;
    renderIncomeLog();
  });
  document.getElementById('income-pager-next').addEventListener('click', () => {
    if (incomePager.page >= pages) return;
    incomePager.page += 1;
    renderIncomeLog();
  });
  document.getElementById('income-pager-last').addEventListener('click', () => {
    if (incomePager.page >= pages) return;
    incomePager.page = pages;
    renderIncomeLog();
  });
}

renderIncomeLog();
