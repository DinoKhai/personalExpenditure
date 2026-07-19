// FinTrack – client-side data layer
// Data lives in localStorage (auto-saved, no server needed).
// Export to finance.xlsx  ·  Import from finance.xlsx  (via SheetJS CDN)

(function () {
  const STORE_KEY = 'fintrack_v1';

  const DEFAULTS = [
    'Food & Dining', 'Transportation', 'Shopping', 'Entertainment',
    'Healthcare', 'Utilities', 'Education', 'Travel', 'Others'
  ];

  // ── Internals ──────────────────────────────────────────────────────

  function _now() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  function _nextId(rows) {
    if (!rows.length) return 1;
    return Math.max(...rows.map(r => Number(r.id) || 0)) + 1;
  }

  function _read() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupt – re-seed */ }
    return _seed();
  }

  function _seed() {
    const data = {
      categories: DEFAULTS.map((name, i) => ({ id: i + 1, name, created_at: _now() })),
      expenditures: [],
      spending_limits: []
    };
    _write(data);
    return data;
  }

  function _write(data) {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }

  // ── Date filtering ─────────────────────────────────────────────────

  function _dateFilter(rows, { year, month, from, to } = {}) {
    return rows.filter(e => {
      const d = String(e.date || '');
      if (from && d < String(from)) return false;
      if (to   && d > String(to))   return false;
      if (!from) {
        if (year && month) {
          const y = String(year), m = String(month).padStart(2, '0');
          const last = String(new Date(+year, +month, 0).getDate()).padStart(2, '0');
          if (d < `${y}-${m}-01` || d > `${y}-${m}-${last}`) return false;
        } else if (year) {
          if (!d.startsWith(String(year))) return false;
        }
      }
      return true;
    });
  }

  // ── Categories ─────────────────────────────────────────────────────

  function getAllCategories() {
    return [..._read().categories].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function insertCategory(name) {
    const data = _read();
    if (data.categories.find(c => c.name.toLowerCase() === name.toLowerCase()))
      throw new Error('Category already exists');
    const id = _nextId(data.categories);
    data.categories.push({ id, name, created_at: _now() });
    _write(data);
    return id;
  }

  function updateCategory(id, name) {
    const data = _read();
    const numId = Number(id);
    if (data.categories.find(c => c.name.toLowerCase() === name.toLowerCase() && Number(c.id) !== numId))
      throw new Error('Category already exists');
    data.categories = data.categories.map(c => Number(c.id) === numId ? { ...c, name } : c);
    _write(data);
  }

  function deleteCategory(id) {
    const data = _read();
    const numId = Number(id);
    const used = data.expenditures.filter(e => Number(e.category_id) === numId).length;
    if (used > 0) throw new Error(`Cannot delete: ${used} entry(ies) use this category`);
    data.categories     = data.categories.filter(c => Number(c.id) !== numId);
    data.spending_limits = data.spending_limits.filter(s => Number(s.category_id) !== numId);
    _write(data);
  }

  // ── Spending Limits ────────────────────────────────────────────────

  function getSpendingLimits() {
    const { categories, spending_limits } = _read();
    return spending_limits.map(s => ({
      ...s,
      category_name: (categories.find(c => Number(c.id) === Number(s.category_id)) || {}).name
    })).sort((a, b) => String(a.category_name).localeCompare(String(b.category_name)));
  }

  function upsertSpendingLimit(category_id, monthly_limit) {
    const data = _read();
    const numCat = Number(category_id);
    const i = data.spending_limits.findIndex(s => Number(s.category_id) === numCat);
    if (i >= 0) {
      data.spending_limits[i] = { ...data.spending_limits[i], monthly_limit: Number(monthly_limit) };
    } else {
      data.spending_limits.push({
        id: _nextId(data.spending_limits), category_id: numCat, monthly_limit: Number(monthly_limit)
      });
    }
    _write(data);
  }

  function deleteSpendingLimit(category_id) {
    const data = _read();
    data.spending_limits = data.spending_limits.filter(s => Number(s.category_id) !== Number(category_id));
    _write(data);
  }

  // ── Expenditures ───────────────────────────────────────────────────

  function getExpenditures(filters = {}) {
    const { categories, expenditures } = _read();
    let rows = _dateFilter(expenditures, filters);
    if (filters.category) rows = rows.filter(e => Number(e.category_id) === Number(filters.category));
    return rows.map(e => ({
      ...e,
      category_name: (categories.find(c => Number(c.id) === Number(e.category_id)) || {}).name
    })).sort((a, b) => b.date > a.date ? 1 : b.date < a.date ? -1 : Number(b.id) - Number(a.id));
  }

  function getExpenditureById(id) {
    const { categories, expenditures } = _read();
    const e = expenditures.find(e => Number(e.id) === Number(id));
    if (!e) return null;
    return { ...e, category_name: (categories.find(c => Number(c.id) === Number(e.category_id)) || {}).name };
  }

  function insertExpenditure({ date, category_id, amount, notes }) {
    const data = _read();
    const id = _nextId(data.expenditures);
    data.expenditures.push({
      id, date: String(date), category_id: Number(category_id),
      amount: Number(amount), notes: notes || '', created_at: _now()
    });
    _write(data);
    return id;
  }

  function updateExpenditure(id, { date, category_id, amount, notes }) {
    const data = _read();
    data.expenditures = data.expenditures.map(e =>
      Number(e.id) === Number(id)
        ? { ...e, date: String(date), category_id: Number(category_id), amount: Number(amount), notes: notes || '' }
        : e
    );
    _write(data);
  }

  function deleteExpenditure(id) {
    const data = _read();
    data.expenditures = data.expenditures.filter(e => Number(e.id) !== Number(id));
    _write(data);
  }

  // ── Summary ────────────────────────────────────────────────────────

  function getSummary(filters = {}) {
    const { categories, expenditures, spending_limits } = _read();
    let rows = _dateFilter(expenditures, filters);
    if (filters.category) rows = rows.filter(e => Number(e.category_id) === Number(filters.category));
    return categories.map(cat => {
      const total = rows.filter(e => Number(e.category_id) === Number(cat.id))
                       .reduce((s, e) => s + Number(e.amount), 0);
      const lr = spending_limits.find(s => Number(s.category_id) === Number(cat.id));
      return { id: cat.id, category_name: cat.name, total, monthly_limit: lr ? Number(lr.monthly_limit) : null };
    }).sort((a, b) => b.total - a.total);
  }

  // ── Reports ────────────────────────────────────────────────────────

  function getReports(year) {
    const { categories, expenditures, spending_limits } = _read();
    const ys  = String(year);
    const yr  = expenditures.filter(e => String(e.date || '').startsWith(ys));

    // By month
    const mMap = {};
    yr.forEach(e => { const m = String(e.date).slice(5, 7); mMap[m] = (mMap[m] || 0) + Number(e.amount); });
    const byMonth = Object.entries(mMap)
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // By category
    const cMap = {};
    yr.forEach(e => {
      const cat = categories.find(c => Number(c.id) === Number(e.category_id));
      if (!cat) return;
      cMap[cat.name] = (cMap[cat.name] || 0) + Number(e.amount);
    });
    const byCategory = Object.entries(cMap).map(([category, total]) => {
      const cat = categories.find(c => c.name === category);
      const lr  = cat ? spending_limits.find(s => Number(s.category_id) === Number(cat.id)) : null;
      return { category, total, monthly_limit: lr ? Number(lr.monthly_limit) : null };
    }).sort((a, b) => b.total - a.total);

    // Monthly per category (stacked chart)
    const mcMap = {};
    yr.forEach(e => {
      const m = String(e.date).slice(5, 7);
      const cat = categories.find(c => Number(c.id) === Number(e.category_id));
      if (!cat) return;
      const k = `${m}||${cat.name}`;
      mcMap[k] = (mcMap[k] || 0) + Number(e.amount);
    });
    const monthly = Object.entries(mcMap)
      .map(([k, total]) => { const [month, category] = k.split('||'); return { month, category, total }; })
      .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));

    return { byMonth, byCategory, monthly, year };
  }

  // ── Excel Export ───────────────────────────────────────────────────

  function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('SheetJS not loaded. Check your internet connection.'); return; }
    const { categories, expenditures, spending_limits } = _read();
    const wb = XLSX.utils.book_new();
    const add = (name, rows, hdr) => {
      const ws = rows.length ? XLSX.utils.json_to_sheet(rows, { header: hdr }) : XLSX.utils.aoa_to_sheet([hdr]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add('Categories',     categories,      ['id', 'name', 'created_at']);
    add('Expenditures',   expenditures,    ['id', 'date', 'category_id', 'amount', 'notes', 'created_at']);
    add('SpendingLimits', spending_limits, ['id', 'category_id', 'monthly_limit']);
    XLSX.writeFile(wb, 'finance.xlsx');
  }

  // ── Excel Import ───────────────────────────────────────────────────

  function importFromExcel(file, callback) {
    if (typeof XLSX === 'undefined') { callback(new Error('SheetJS not loaded')); return; }
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const toRows = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null }) : [];
        const data = {
          categories:      toRows('Categories'),
          expenditures:    toRows('Expenditures'),
          spending_limits: toRows('SpendingLimits')
        };
        if (!Array.isArray(data.categories)) throw new Error('Invalid file format');
        _write(data);
        if (callback) callback(null);
      } catch (err) {
        if (callback) callback(err);
      }
    };
    reader.readAsBinaryString(file);
  }

  // ── Expose globally ────────────────────────────────────────────────

  window.DB = {
    getAllCategories,
    insertCategory,
    updateCategory,
    deleteCategory,
    getSpendingLimits,
    upsertSpendingLimit,
    deleteSpendingLimit,
    getExpenditures,
    getExpenditureById,
    insertExpenditure,
    updateExpenditure,
    deleteExpenditure,
    getSummary,
    getReports,
    exportToExcel,
    importFromExcel
  };
})();
