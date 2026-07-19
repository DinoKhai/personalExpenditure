// FinTrack – client-side data layer
// Data lives in localStorage (auto-saved, no server needed).
// Export to finance.xlsx  ·  Import from finance.xlsx  (via SheetJS CDN)

(function () {
  const STORE_KEY = 'fintrack_v1';
  let storeCache = null;

  const DEFAULTS = [
    'Food & Dining', 'Transportation', 'Shopping', 'Entertainment',
    'Healthcare', 'Utilities', 'Education', 'Travel', 'Others'
  ];
  const CATEGORY_COLORS = [
    '#7c6af7', '#22c55e', '#f59e0b', '#f43f5e', '#38bdf8',
    '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#2dd4bf',
    '#60a5fa', '#84cc16', '#eab308', '#ef4444', '#14b8a6',
    '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#ec4899'
  ];

  // ── Internals ──────────────────────────────────────────────────────

  function _now() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
  }

  function _nextId(rows) {
    if (!rows.length) return 1;
    return Math.max(...rows.map(r => Number(r.id) || 0)) + 1;
  }

  function _isValidHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim());
  }

  function _pickNextCategoryColor(usedSet) {
    const preset = CATEGORY_COLORS.find(c => !usedSet.has(c.toLowerCase()));
    if (preset) return preset;
    for (let i = 0; i < 500; i++) {
      const c = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      if (!usedSet.has(c.toLowerCase())) return c;
    }
    // Last resort deterministic fallback
    return '#'+Date.now().toString(16).slice(-6).padStart(6, '0');
  }

  function _normalizeCategories(categories) {
    let changed = false;
    const used = new Set();
    const normalized = (Array.isArray(categories) ? categories : []).map((c, idx) => {
      const next = { ...c };
      if (next.id === undefined || next.id === null || Number.isNaN(Number(next.id))) {
        next.id = idx + 1;
        changed = true;
      } else {
        next.id = Number(next.id);
      }
      if (!next.created_at) {
        next.created_at = _now();
        changed = true;
      }
      const candidate = _isValidHexColor(next.color) ? next.color.trim() : null;
      if (!candidate || used.has(candidate.toLowerCase())) {
        next.color = _pickNextCategoryColor(used);
        changed = true;
      } else {
        next.color = candidate;
      }
      used.add(next.color.toLowerCase());
      return next;
    });
    return { normalized, changed };
  }

  function _read() {
    if (storeCache) return storeCache;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const data = {
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
          expenditures: Array.isArray(parsed.expenditures) ? parsed.expenditures : [],
          spending_limits: Array.isArray(parsed.spending_limits) ? parsed.spending_limits : []
        };
        const { normalized, changed } = _normalizeCategories(data.categories);
        data.categories = normalized;
        if (changed) _write(data);
        else storeCache = data;
        return data;
      }
    } catch (e) { /* corrupt – re-seed */ }
    return _seed();
  }

  function _seed() {
    const used = new Set();
    const data = {
      categories: DEFAULTS.map((name, i) => {
        const color = _pickNextCategoryColor(used);
        used.add(color.toLowerCase());
        return { id: i + 1, name, color, created_at: _now() };
      }),
      expenditures: [],
      spending_limits: []
    };
    _write(data);
    return data;
  }

  function _write(data) {
    storeCache = data;
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
    const used = new Set(data.categories.map(c => String(c.color || '').toLowerCase()).filter(Boolean));
    data.categories.push({ id, name, color: _pickNextCategoryColor(used), created_at: _now() });
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
    const categoryById = {};
    categories.forEach(c => { categoryById[Number(c.id)] = c; });
    return rows.map(e => ({
      ...e,
      category_name: (categoryById[Number(e.category_id)] || {}).name,
      category_color: (categoryById[Number(e.category_id)] || {}).color || '#7c6af7'
    })).sort((a, b) => b.date > a.date ? 1 : b.date < a.date ? -1 : Number(b.id) - Number(a.id));
  }

  function getExpenditureById(id) {
    const { categories, expenditures } = _read();
    const e = expenditures.find(e => Number(e.id) === Number(id));
    if (!e) return null;
    const cat = categories.find(c => Number(c.id) === Number(e.category_id)) || {};
    return { ...e, category_name: cat.name, category_color: cat.color || '#7c6af7' };
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
    const totalsByCategoryId = {};
    rows.forEach(e => {
      const key = Number(e.category_id);
      totalsByCategoryId[key] = (totalsByCategoryId[key] || 0) + Number(e.amount);
    });
    const limitByCategoryId = {};
    spending_limits.forEach(s => { limitByCategoryId[Number(s.category_id)] = Number(s.monthly_limit); });
    return categories.map(cat => {
      const id = Number(cat.id);
      const total = totalsByCategoryId[id] || 0;
      const monthlyLimit = Number.isFinite(limitByCategoryId[id]) ? limitByCategoryId[id] : null;
      return { id: cat.id, category_name: cat.name, category_color: cat.color || '#7c6af7', total, monthly_limit: monthlyLimit };
    }).sort((a, b) => b.total - a.total);
  }

  // ── Reports ────────────────────────────────────────────────────────

  function getReports(year, month = '') {
    const { categories, expenditures, spending_limits } = _read();
    const categoryById = {};
    categories.forEach(c => { categoryById[Number(c.id)] = c; });
    const categoryByName = {};
    categories.forEach(c => { categoryByName[String(c.name)] = c; });
    const limitByCategoryId = {};
    spending_limits.forEach(s => { limitByCategoryId[Number(s.category_id)] = Number(s.monthly_limit); });
    const ys  = String(year);
    const ms = month ? String(month).padStart(2, '0') : '';
    const yr  = expenditures.filter(e => {
      const d = String(e.date || '');
      if (!d.startsWith(ys)) return false;
      if (ms && d.slice(5, 7) !== ms) return false;
      return true;
    });

    // By month
    const mMap = {};
    yr.forEach(e => { const m = String(e.date).slice(5, 7); mMap[m] = (mMap[m] || 0) + Number(e.amount); });
    const byMonth = Object.entries(mMap)
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // By category
    const cMap = {};
    yr.forEach(e => {
      const cat = categoryById[Number(e.category_id)];
      if (!cat) return;
      cMap[cat.name] = (cMap[cat.name] || 0) + Number(e.amount);
    });
    const byCategory = Object.entries(cMap).map(([category, total]) => {
      const cat = categoryByName[category];
      const monthlyLimit = cat ? limitByCategoryId[Number(cat.id)] : null;
      return { category, category_color: cat ? (cat.color || '#7c6af7') : '#7c6af7', total, monthly_limit: Number.isFinite(monthlyLimit) ? monthlyLimit : null };
    }).sort((a, b) => b.total - a.total);

    // Monthly per category (stacked chart)
    const mcMap = {};
    yr.forEach(e => {
      const m = String(e.date).slice(5, 7);
      const cat = categoryById[Number(e.category_id)];
      if (!cat) return;
      const k = `${m}||${cat.name}`;
      mcMap[k] = (mcMap[k] || 0) + Number(e.amount);
    });
    const monthly = Object.entries(mcMap)
      .map(([k, total]) => { const [month, category] = k.split('||'); return { month, category, total }; })
      .sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category));

    return { byMonth, byCategory, monthly, year, month: ms };
  }

  // ── General Budget Goal (month/year scoped) ────────────────────────

  const GOAL_KEY = 'fintrack_goals_v1';
  const LEGACY_GOAL_KEY = 'fintrack_goal_v1';
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function _goalId(year, month) {
    return Number(year) * 100 + Number(month);
  }

  function _normalizeYearMonth(year, month) {
    const now = new Date();
    const y = Number(year || now.getFullYear());
    const m = Number(month || (now.getMonth() + 1));
    if (!Number.isInteger(y) || y < 1900 || y > 9999) throw new Error('Invalid year');
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Invalid month');
    return { year: y, month: m };
  }

  function _readGoals() {
    try {
      const raw = localStorage.getItem(GOAL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map(g => ({
              id: Number(g.id || _goalId(g.year, g.month)),
              year: Number(g.year),
              month: Number(g.month),
              amount: Number(g.amount),
              updated_at: g.updated_at || _now()
            }))
            .filter(g =>
              Number.isFinite(g.year) &&
              Number.isFinite(g.month) &&
              g.month >= 1 &&
              g.month <= 12 &&
              Number.isFinite(g.amount) &&
              g.amount >= 0
            );
          return _ensureCurrentMonthGoal(normalized);
        }
      }
    } catch (e) { /* ignore bad payload */ }

    // One-time legacy migration: old single-value monthly goal -> current month
    const legacy = localStorage.getItem(LEGACY_GOAL_KEY);
    if (legacy !== null && legacy !== '') {
      const amount = Number(legacy);
      if (Number.isFinite(amount) && amount > 0) {
        const now = new Date();
        const migrated = [{
          id: _goalId(now.getFullYear(), now.getMonth() + 1),
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          amount,
          updated_at: _now()
        }];
        localStorage.setItem(GOAL_KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_GOAL_KEY);
        return _ensureCurrentMonthGoal(migrated);
      }
      localStorage.removeItem(LEGACY_GOAL_KEY);
    }
    return _ensureCurrentMonthGoal([]);
  }

  function _writeGoals(goals) {
    localStorage.setItem(GOAL_KEY, JSON.stringify(goals));
  }

  function _previousYearMonth(year, month) {
    if (month === 1) return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
  }

  function _ensureCurrentMonthGoal(goals) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const hasCurrent = goals.some(g => g.year === y && g.month === m);
    if (hasCurrent) return goals;

    const prev = _previousYearMonth(y, m);
    const prevGoal = goals.find(g => g.year === prev.year && g.month === prev.month);
    if (!prevGoal) return goals;

    const nextGoals = [...goals, {
      id: _goalId(y, m),
      year: y,
      month: m,
      amount: Number(prevGoal.amount),
      updated_at: _now()
    }];
    _writeGoals(nextGoals);
    return nextGoals;
  }

  function getBudgetGoals(filters = {}) {
    const y = filters.year ? Number(filters.year) : null;
    const m = filters.month ? Number(filters.month) : null;
    return _readGoals()
      .filter(g => (!y || g.year === y) && (!m || g.month === m))
      .sort((a, b) => (b.year - a.year) || (b.month - a.month));
  }

  function setGeneralGoal(amount, year, month) {
    const { year: y, month: m } = _normalizeYearMonth(year, month);
    const goals = _readGoals();
    const idx = goals.findIndex(g => g.year === y && g.month === m);

    if (amount === null || amount === '') {
      if (idx >= 0) {
        goals.splice(idx, 1);
        _writeGoals(goals);
      }
      return;
    }

    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid goal amount');
    const next = { id: _goalId(y, m), year: y, month: m, amount: n, updated_at: _now() };
    if (idx >= 0) goals[idx] = next;
    else goals.push(next);
    _writeGoals(goals);
  }

  function getGeneralGoal(filters = {}) {
    const goals = _readGoals();
    const hasYear = !!filters.year;
    const hasMonth = !!filters.month;
    const y = hasYear ? Number(filters.year) : null;
    const m = hasMonth ? Number(filters.month) : null;

    if (hasYear && hasMonth) {
      const hit = goals.find(g => g.year === y && g.month === m);
      return hit ? Number(hit.amount) : null;
    }
    if (hasYear) {
      const sum = goals.filter(g => g.year === y).reduce((s, g) => s + Number(g.amount), 0);
      return sum > 0 ? sum : null;
    }
    if (hasMonth) {
      const sum = goals.filter(g => g.month === m).reduce((s, g) => s + Number(g.amount), 0);
      return sum > 0 ? sum : null;
    }

    const now = new Date();
    const curr = goals.find(g => g.year === now.getFullYear() && g.month === (now.getMonth() + 1));
    return curr ? Number(curr.amount) : null;
  }

  function getGoalScopeLabel(filters = {}) {
    const hasYear = !!filters.year;
    const hasMonth = !!filters.month;
    if (hasYear && hasMonth) return `${MONTH_NAMES[Number(filters.month) - 1]} ${filters.year}`;
    if (hasYear) return `Year ${filters.year}`;
    if (hasMonth) return `${MONTH_NAMES[Number(filters.month) - 1]} (All Years)`;
    const now = new Date();
    return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
  }

  // ── Excel Export ───────────────────────────────────────────────────

  function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('SheetJS not loaded. Check your internet connection.'); return; }
    const { categories, expenditures, spending_limits } = _read();
    const budget_goals = _readGoals();
    const wb = XLSX.utils.book_new();
    const add = (name, rows, hdr) => {
      const ws = rows.length ? XLSX.utils.json_to_sheet(rows, { header: hdr }) : XLSX.utils.aoa_to_sheet([hdr]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add('Categories',     categories,      ['id', 'name', 'color', 'created_at']);
    add('Expenditures',   expenditures,    ['id', 'date', 'category_id', 'amount', 'notes', 'created_at']);
    add('SpendingLimits', spending_limits, ['id', 'category_id', 'monthly_limit']);
    add('BudgetGoals',    budget_goals,    ['id', 'year', 'month', 'amount', 'updated_at']);

    // Shared fallback used for desktop and when mobile share is denied.
    const triggerDownload = (blob) => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'finance.xlsx';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    };

    // Use Web Share API on mobile (iOS Share Sheet → Save to Files).
    // If denied/fails, gracefully fall back to direct download.
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob  = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const canUseShare = (() => {
      try {
        if (typeof File === 'undefined') return false;
        const file = new File([blob], 'finance.xlsx', { type: blob.type });
        return !!(navigator.canShare && navigator.canShare({ files: [file] }));
      } catch (e) {
        return false;
      }
    })();

    if (canUseShare) {
      const file = new File([blob], 'finance.xlsx', { type: blob.type });
      navigator.share({ files: [file], title: 'FinTrack Export' })
        .catch(err => {
          if (err && err.name === 'AbortError') return;
          triggerDownload(blob);
        });
      return;
    }

    triggerDownload(blob);
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
        const hasBudgetGoalsSheet = !!wb.Sheets.BudgetGoals;
        const budgetGoals = toRows('BudgetGoals');
        if (!Array.isArray(data.categories)) throw new Error('Invalid file format');
        const { normalized } = _normalizeCategories(data.categories);
        data.categories = normalized;
        _write(data);
        if (hasBudgetGoalsSheet) {
          _writeGoals(Array.isArray(budgetGoals) ? budgetGoals.map(g => ({
            id: Number(g.id || _goalId(g.year, g.month)),
            year: Number(g.year),
            month: Number(g.month),
            amount: Number(g.amount),
            updated_at: g.updated_at || _now()
          })).filter(g =>
            Number.isFinite(g.year) &&
            Number.isFinite(g.month) &&
            g.month >= 1 &&
            g.month <= 12 &&
            Number.isFinite(g.amount) &&
            g.amount >= 0
          ) : []);
        }
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
    importFromExcel,
    getGeneralGoal,
    setGeneralGoal,
    getBudgetGoals,
    getGoalScopeLabel
  };
})();
