/* reports.js – Chart.js reports (static / no server) */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let charts = {};

function getNowParts() {
  if (window.AppTime && typeof window.AppTime.getISTNowParts === 'function') return window.AppTime.getISTNowParts();
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function isPerformanceMode() {
  return !!(window.AppPrefs && typeof window.AppPrefs.isPerformanceMode === 'function' && window.AppPrefs.isPerformanceMode());
}

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    text:   s.getPropertyValue('--text').trim()   || '#e6e6f0',
    text2:  s.getPropertyValue('--text-2').trim() || '#a0a0b8',
    text3:  s.getPropertyValue('--text-3').trim() || '#606078',
    border: s.getPropertyValue('--border').trim() || '#2a2a36',
    card:   s.getPropertyValue('--card').trim()   || '#17171d',
    primary: s.getPropertyValue('--primary').trim() || '#f97316',
    accent2: s.getPropertyValue('--accent-2').trim() || '#22c55e',
    accent3: s.getPropertyValue('--accent-3').trim() || '#f59e0b',
  };
}

function chartDefaults() {
  const c = getThemeColors();
  Chart.defaults.color = c.text2;
  Chart.defaults.borderColor = c.border;
  Chart.defaults.animation = isPerformanceMode() ? false : { duration: 260 };
  Chart.defaults.plugins.tooltip.backgroundColor = c.card;
  Chart.defaults.plugins.tooltip.titleColor      = c.text;
  Chart.defaults.plugins.tooltip.bodyColor       = c.text2;
  Chart.defaults.plugins.tooltip.borderColor     = c.border;
  Chart.defaults.plugins.tooltip.borderWidth     = 1;
  Chart.defaults.plugins.legend.labels.color     = c.text2;
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

/* ── Year selector ──────────────────────────────────────────────────── */
function populateYears() {
  const sel = document.getElementById('rep-year');
  const now = getNowParts().year;
  for (let y = now + 1; y >= now - 5; y--) {
    sel.innerHTML += `<option value="${y}" ${y === now ? 'selected' : ''}>${y}</option>`;
  }
}

/* ── Load & render ──────────────────────────────────────────────────── */
function loadReport() {
  chartDefaults();
  const year = document.getElementById('rep-year').value;
  const month = document.getElementById('rep-month').value;
  const scope = month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
  document.getElementById('chart1-year').textContent = scope;

  const data = DB.getReports(year, month);
  const txRows = DB.getExpenditures({ year, month });
  renderTransactionSummary(txRows, data, year, month);
  renderStats(data, year, month);
  renderMonthlyChart(data.byMonth, year);
  renderCategoryChart(data.byCategory);
  renderStackedChart(data.monthly, data.byCategory);
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function alpha(hex, a) {
  const m = String(hex || '').trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function contrastText(hex) {
  const m = String(hex || '').trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq >= 150 ? '#111827' : '#ffffff';
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function renderTransactionSummary(rows, data, year, month = '') {
  const container = document.getElementById('rep-summary');
  const scopeLabel = month ? `${MONTHS[Number(month) - 1]} ${year}` : `Year ${year}`;

  if (!rows.length) {
    container.innerHTML = `
      <h3>Transaction Summary</h3>
      <p class="scope">${scopeLabel}</p>
      <ul><li>No transactions found for this period.</li></ul>`;
    return;
  }

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const avg = total / rows.length;
  const med = median(rows.map(r => Number(r.amount || 0)));
  const topCat = data.byCategory[0];
  const maxTx = rows.reduce((best, r) => Number(r.amount) > Number(best.amount) ? r : best, rows[0]);
  const activeDays = new Set(rows.map(r => r.date)).size;
  const topCatPct = topCat ? Math.round((Number(topCat.total || 0) / total) * 100) : 0;
  const top3Total = data.byCategory.slice(0, 3).reduce((s, r) => s + Number(r.total || 0), 0);
  const top3Pct = total ? Math.round((top3Total / total) * 100) : 0;
  const top3BySpend = data.byCategory.slice(0, 3);
  const categoryColorMap = {};
  data.byCategory.forEach(r => { categoryColorMap[r.category] = r.category_color || '#f97316'; });
  rows.forEach(r => {
    if (!categoryColorMap[r.category_name] && r.category_color) categoryColorMap[r.category_name] = r.category_color;
  });
  const catLabel = (name) => {
    const safe = escHtml(name);
    const color = categoryColorMap[name] || '#f97316';
    return `<strong style="color:${color}">${safe}</strong>`;
  };

  const countMap = {};
  rows.forEach(r => {
    const k = r.category_name || 'Unknown';
    countMap[k] = (countMap[k] || 0) + 1;
  });
  const top3ByCount = Object.entries(countMap)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3);

  const goal = DB.getGeneralGoal({ year, month });
  const goalLine = goal
    ? (total <= goal
      ? `Budget status: <strong>₹${formatINR(goal - total, 0)}</strong> remaining out of <strong>₹${formatINR(goal, 0)}</strong> goal.`
      : `Budget status: <strong>₹${formatINR(total - goal, 0)}</strong> over the <strong>₹${formatINR(goal, 0)}</strong> goal.`)
    : 'Budget status: No budget goal set for this scope.';

  const dayMap = {};
  rows.forEach(r => { dayMap[r.date] = (dayMap[r.date] || 0) + Number(r.amount || 0); });
  const [peakDay, peakDayTotal] = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];

  let weekendTotal = 0;
  let weekdayTotal = 0;
  rows.forEach(r => {
    const d = new Date(`${r.date}T00:00:00`);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) weekendTotal += Number(r.amount || 0);
    else weekdayTotal += Number(r.amount || 0);
  });
  const weekendPct = total ? Math.round((weekendTotal / total) * 100) : 0;

  const breachBaseMultiplier = month ? 1 : 12;
  const breaches = data.byCategory
    .filter(r => r.monthly_limit && Number(r.total) > Number(r.monthly_limit) * breachBaseMultiplier)
    .map(r => r.category)
    .slice(0, 3);
  const breachLine = breaches.length
    ? `Limit breaches: ${breaches.map(name => catLabel(name)).join(', ')}${data.byCategory.filter(r => r.monthly_limit && Number(r.total) > Number(r.monthly_limit) * breachBaseMultiplier).length > 3 ? ' +' : ''}.`
    : 'Limit breaches: None.';

  let prevRows = [];
  let comparisonLabel = '';
  if (month) {
    const m = Number(month);
    const y = Number(year);
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    prevRows = DB.getExpenditures({ year: py, month: pm });
    comparisonLabel = `${MONTHS[pm - 1]} ${py}`;
  } else {
    const py = Number(year) - 1;
    prevRows = DB.getExpenditures({ year: py });
    comparisonLabel = String(py);
  }
  const prevTotal = prevRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const delta = total - prevTotal;
  const deltaPct = prevTotal ? Math.round((delta / prevTotal) * 100) : null;
  const compareLine = prevTotal
    ? `Compared to ${comparisonLabel}: ${delta >= 0 ? 'up' : 'down'} <strong>₹${formatINR(Math.abs(delta), 0)}</strong> (${deltaPct >= 0 ? '+' : ''}${deltaPct}%).`
    : `Compared to ${comparisonLabel}: no prior data.`;

  container.innerHTML = `
    <h3>Transaction Summary</h3>
    <p class="scope">${scopeLabel}</p>
    <ul>
      <li>${rows.length} transaction${rows.length === 1 ? '' : 's'} across ${activeDays} active day${activeDays === 1 ? '' : 's'}.</li>
      <li>Total spend: <strong>₹${formatINR(total, 0)}</strong> · Avg: <strong>₹${formatINR(avg, 0)}</strong> · Median: <strong>₹${formatINR(med, 0)}</strong>.</li>
      ${topCat ? `<li>Top category: ${catLabel(topCat.category)} (${topCatPct}% of total, <strong>₹${formatINR(topCat.total, 0)}</strong>).</li>` : ''}
      <li>Top 3 by spend: ${top3BySpend.map(r => `${catLabel(r.category)} (<strong>₹${formatINR(r.total, 0)}</strong>)`).join(', ')} (${top3Pct}% of total).</li>
      <li>Top categories by transaction count: ${top3ByCount.map(([name, cnt]) => `${catLabel(name)} (${cnt})`).join(', ')}.</li>
      <li>Largest transaction: <strong>₹${formatINR(maxTx.amount, 0)}</strong> on ${formatDate(maxTx.date)} (${catLabel(maxTx.category_name)}).</li>
      <li>Highest spending day: ${formatDate(peakDay)} (<strong>₹${formatINR(peakDayTotal, 0)}</strong>).</li>
      <li>Weekend vs weekday: <strong>₹${formatINR(weekendTotal, 0)}</strong> (${weekendPct}%) vs <strong>₹${formatINR(weekdayTotal, 0)}</strong> (${100 - weekendPct}%).</li>
      <li>${goalLine}</li>
      <li>${breachLine}</li>
      <li>${compareLine}</li>
    </ul>`;
}

/* ── KPI Stats ──────────────────────────────────────────────────────── */
function renderStats(data, year, month = '') {
  const t = getThemeColors();
  const isLight = document.documentElement.classList.contains('light');
  const total      = data.byMonth.reduce((s, r) => s + r.total, 0);
  const avgMonthly = data.byMonth.length ? total / data.byMonth.length : 0;
  const topCat     = data.byCategory[0];
  const scopeLabel = month ? `${MONTHS[Number(month) - 1]} ${year}` : year;
  const totalBg = t.primary;
  const avgBg = t.accent2;
  const activeBg = t.accent3;
  const topBg = topCat ? (topCat.category_color || t.accent3) : t.accent3;
  const totalFg = isLight ? totalBg : alpha(totalBg, .95);
  const avgFg = isLight ? avgBg : alpha(avgBg, .95);
  const activeFg = isLight ? activeBg : alpha(activeBg, .95);
  const topFg = isLight ? topBg : alpha(topBg, .95);
  const kpiLabelColor = isLight ? 'rgba(15,23,42,.82)' : 'rgba(243,245,255,.86)';
  const kpiBg = (color) => alpha(color, isLight ? .24 : .16);

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-box" style="border:none;background:${kpiBg(totalBg)};">
      <div class="stat-val" style="color:${totalFg}">₹${formatINR(total, 0)}</div>
      <div class="stat-lbl" style="color:${kpiLabelColor};">Total Spent ${scopeLabel}</div>
    </div>
    <div class="stat-box" style="border:none;background:${kpiBg(avgBg)};">
      <div class="stat-val" style="color:${avgFg}">₹${formatINR(avgMonthly, 0)}</div>
      <div class="stat-lbl" style="color:${kpiLabelColor};">Avg / Active Month</div>
    </div>
    <div class="stat-box" style="border:none;background:${kpiBg(activeBg)};">
      <div class="stat-val" style="color:${activeFg}">${data.byMonth.length}</div>
      <div class="stat-lbl" style="color:${kpiLabelColor};">Active Months</div>
    </div>
    ${topCat ? `
    <div class="stat-box" style="border:none;background:${kpiBg(topBg)};">
      <div class="stat-val" style="font-size:1.1rem;color:${topFg}">${topCat.category}</div>
      <div class="stat-lbl" style="color:${kpiLabelColor};">Top Category</div>
    </div>` : ''}`;
}

/* ── Chart 1: Monthly totals ────────────────────────────────────────── */
function renderMonthlyChart(byMonth, year) {
  destroyChart('monthly');
  const data = Array(12).fill(0);
  byMonth.forEach(r => { data[parseInt(r.month) - 1] = r.total; });

  charts.monthly = new Chart(document.getElementById('chart-monthly'), {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [{
        label: `Monthly Spending ${year}`,
        data,
        backgroundColor: data.map(v => v > 0 ? 'rgba(124,106,247,0.75)' : 'rgba(42,42,54,0.4)'),
        borderColor:     data.map(v => v > 0 ? '#7c6af7' : 'transparent'),
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      animation: isPerformanceMode() ? false : { duration: 260 },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ' ₹' + formatINR(ctx.parsed.y) } }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: getThemeColors().border },
          ticks: { callback: v => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });
}

/* ── Chart 2: Category totals (horizontal bar) ──────────────────────── */
function renderCategoryChart(byCategory) {
  destroyChart('category');
  if (!byCategory.length) return;

  const labels = byCategory.map(r => r.category);
  const totals = byCategory.map(r => r.total);
  const limits = byCategory.map(r => r.monthly_limit ? r.monthly_limit * 12 : null);

  const datasets = [{
    label: 'Actual Spending',
    data: totals,
    backgroundColor: byCategory.map(r => (r.category_color || '#7c6af7') + 'cc'),
    borderColor:     byCategory.map(r => (r.category_color || '#7c6af7')),
    borderWidth: 1.5,
    borderRadius: 4,
  }];

  if (limits.some(l => l !== null)) {
    datasets.push({
      label: 'Yearly Limit',
      data: limits,
      backgroundColor: 'rgba(239,68,68,0.15)',
      borderColor: 'rgba(239,68,68,0.7)',
      borderWidth: 1.5,
      borderDash: [6, 3],
      type: 'bar',
      borderRadius: 4,
    });
  }

  charts.category = new Chart(document.getElementById('chart-category'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      animation: isPerformanceMode() ? false : { duration: 260 },
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ₹${formatINR(ctx.parsed.x || 0)}` } }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: getThemeColors().border },
          ticks: { callback: v => '₹' + (v >= 100000 ? (v/100000).toFixed(1)+'L' : v >= 1000 ? (v/1000).toFixed(0)+'k' : v) }
        },
        y: { grid: { display: false } }
      }
    }
  });
}

/* ── Chart 3: Stacked monthly breakdown ─────────────────────────────── */
function renderStackedChart(monthly, byCategory) {
  destroyChart('stacked');
  if (!monthly.length) return;

  const catNames = [...new Set(monthly.map(r => r.category))];
  const colorByCategory = {};
  byCategory.forEach(r => { colorByCategory[r.category] = r.category_color || '#7c6af7'; });
  const datasets = catNames.map((cat) => {
    const data = Array(12).fill(0);
    monthly.filter(r => r.category === cat).forEach(r => { data[parseInt(r.month) - 1] = r.total; });
    const color = colorByCategory[cat] || '#7c6af7';
    return {
      label: cat,
      data,
      backgroundColor: color + 'cc',
      borderColor:     color,
      borderWidth: 1,
      borderRadius: 3,
    };
  });

  charts.stacked = new Chart(document.getElementById('chart-stacked'), {
    type: 'bar',
    data: { labels: MONTHS, datasets },
    options: {
      animation: isPerformanceMode() ? false : { duration: 260 },
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ₹${formatINR(ctx.parsed.y)}` } }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: getThemeColors().border },
          ticks: { callback: v => '₹' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v) }
        }
      }
    }
  });
}

/* ── Init ───────────────────────────────────────────────────────────── */
populateYears();
document.getElementById('rep-month').value = '';
document.getElementById('rep-apply').addEventListener('click', loadReport);

// Re-render charts when theme toggles
new MutationObserver(() => loadReport())
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

loadReport();
