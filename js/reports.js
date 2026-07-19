/* reports.js – Chart.js reports (static / no server) */
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const PALETTE = [
  '#7c6af7','#22c55e','#f59e0b','#f43f5e','#38bdf8',
  '#a78bfa','#34d399','#fb923c','#f472b6','#2dd4bf'
];

let charts = {};

function getThemeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    text:   s.getPropertyValue('--text').trim()   || '#e6e6f0',
    text2:  s.getPropertyValue('--text-2').trim() || '#a0a0b8',
    text3:  s.getPropertyValue('--text-3').trim() || '#606078',
    border: s.getPropertyValue('--border').trim() || '#2a2a36',
    card:   s.getPropertyValue('--card').trim()   || '#17171d',
  };
}

function chartDefaults() {
  const c = getThemeColors();
  Chart.defaults.color = c.text2;
  Chart.defaults.borderColor = c.border;
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
  const now = new Date().getFullYear();
  for (let y = now + 1; y >= now - 5; y--) {
    sel.innerHTML += `<option value="${y}" ${y === now ? 'selected' : ''}>${y}</option>`;
  }
}

/* ── Load & render ──────────────────────────────────────────────────── */
function loadReport() {
  chartDefaults();
  const year = document.getElementById('rep-year').value;
  document.getElementById('chart1-year').textContent = year;

  const data = DB.getReports(year);
  renderStats(data, year);
  renderMonthlyChart(data.byMonth, year);
  renderCategoryChart(data.byCategory);
  renderStackedChart(data.monthly, data.byCategory);
}

/* ── KPI Stats ──────────────────────────────────────────────────────── */
function renderStats(data, year) {
  const total      = data.byMonth.reduce((s, r) => s + r.total, 0);
  const avgMonthly = data.byMonth.length ? total / data.byMonth.length : 0;
  const topCat     = data.byCategory[0];

  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-box">
      <div class="stat-val">₹${formatINR(total, 0)}</div>
      <div class="stat-lbl">Total Spent ${year}</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">₹${formatINR(avgMonthly, 0)}</div>
      <div class="stat-lbl">Avg / Active Month</div>
    </div>
    <div class="stat-box">
      <div class="stat-val">${data.byMonth.length}</div>
      <div class="stat-lbl">Active Months</div>
    </div>
    ${topCat ? `
    <div class="stat-box">
      <div class="stat-val" style="font-size:1.1rem">${topCat.category}</div>
      <div class="stat-lbl">Top Category</div>
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
    backgroundColor: PALETTE.slice(0, labels.length).map(c => c + 'cc'),
    borderColor:     PALETTE.slice(0, labels.length),
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
  const datasets = catNames.map((cat, i) => {
    const data = Array(12).fill(0);
    monthly.filter(r => r.category === cat).forEach(r => { data[parseInt(r.month) - 1] = r.total; });
    return {
      label: cat,
      data,
      backgroundColor: PALETTE[i % PALETTE.length] + 'cc',
      borderColor:     PALETTE[i % PALETTE.length],
      borderWidth: 1,
      borderRadius: 3,
    };
  });

  charts.stacked = new Chart(document.getElementById('chart-stacked'), {
    type: 'bar',
    data: { labels: MONTHS, datasets },
    options: {
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
document.getElementById('rep-apply').addEventListener('click', loadReport);

// Re-render charts when theme toggles
new MutationObserver(() => loadReport())
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

loadReport();
