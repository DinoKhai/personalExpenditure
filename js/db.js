// FinTrack – client-side data layer
// Data lives in localStorage (auto-saved, no server needed).
// Export to finance.xlsx  ·  Import from finance.xlsx  (via SheetJS CDN)

(function () {
  const STORE_KEY = 'fintrack_v1';
  const CASHFLOW_KEY = 'fintrack_cashflow_v1';
  const GOAL_KEY = 'fintrack_goals_v1';
  const LEGACY_GOAL_KEY = 'fintrack_goal_v1';
  const PERSISTENT_META_KEY = 'fintrack_persistent_excel_meta_v1';
  const HANDLE_DB_NAME = 'fintrack_persistent_excel_db';
  const HANDLE_STORE = 'handles';
  const HANDLE_ID = 'active';
  let storeCache = null;
  let cashflowCache = null;
  let goalsCache = null;
  const persistentExcel = {
    enabled: false,
    handle: null,
    syncing: false,
    importing: false,
    pending: false,
    last_sync_at: null,
    last_error: '',
    loaded_at: null,
    location_label: 'Path unavailable in this browser (security restriction)'
  };

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

  function _getISTParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const out = {};
    formatter.formatToParts(date).forEach(part => {
      if (part.type !== 'literal') out[part.type] = part.value;
    });
    return out;
  }

  function _now() {
    const p = _getISTParts();
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  }

  function _todayISO() {
    const p = _getISTParts();
    return `${p.year}-${p.month}-${p.day}`;
  }

  function _istNowYearMonthDay() {
    const p = _getISTParts();
    return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
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

  function _normalizeTxnType(value) {
    return String(value || '').toLowerCase() === 'credit' ? 'credit' : 'debit';
  }

  function _findOthersCategoryId(categories) {
    const rows = Array.isArray(categories) ? categories : [];
    const exact = rows.find(c => String(c.name || '').trim().toLowerCase() === 'others');
    if (exact) return Number(exact.id);
    const partial = rows.find(c => String(c.name || '').trim().toLowerCase().startsWith('other'));
    if (partial) return Number(partial.id);
    return null;
  }

  function _normalizeExpenditures(rows) {
    let changed = false;
    const normalized = (Array.isArray(rows) ? rows : []).map(r => {
      const next = { ...r };
      const normalizedType = _normalizeTxnType(next.type);
      if (next.type !== normalizedType) {
        next.type = normalizedType;
        changed = true;
      }
      if (!next.created_at) {
        next.created_at = _now();
        changed = true;
      }
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
        const catNorm = _normalizeCategories(data.categories);
        data.categories = catNorm.normalized;
        const expNorm = _normalizeExpenditures(data.expenditures);
        data.expenditures = expNorm.normalized;
        if (catNorm.changed || expNorm.changed) _write(data);
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
    if (persistentExcel.enabled && persistentExcel.handle) {
      _queuePersistentSync();
      return;
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    _queuePersistentSync();
  }

  function _isPersistentExcelSupported() {
    return typeof window !== 'undefined' &&
      typeof window.showOpenFilePicker === 'function' &&
      typeof FileSystemFileHandle !== 'undefined';
  }

  function _getPersistentExcelStatus() {
    const meta = _readPersistentMeta();
    return {
      supported: _isPersistentExcelSupported(),
      enabled: persistentExcel.enabled,
      file_name: persistentExcel.handle ? persistentExcel.handle.name : meta.file_name,
      syncing: persistentExcel.syncing,
      importing: persistentExcel.importing,
      pending: persistentExcel.pending,
      last_sync_at: persistentExcel.last_sync_at || meta.last_sync_at,
      loaded_at: persistentExcel.loaded_at || meta.loaded_at,
      location_label: meta.location_label || persistentExcel.location_label,
      log: meta.log || [],
      linked: !!persistentExcel.enabled,
      last_error: persistentExcel.last_error
    };
  }

  function _emitPersistentExcelStatus() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof CustomEvent === 'undefined') return;
    window.dispatchEvent(new CustomEvent('fintrack:persistent-excel-status', { detail: _getPersistentExcelStatus() }));
  }

  function _readPersistentMeta() {
    try {
      const raw = localStorage.getItem(PERSISTENT_META_KEY);
      if (!raw) return { file_name: '', loaded_at: null, last_sync_at: null, location_label: 'Path unavailable in this browser (security restriction)', log: [] };
      const parsed = JSON.parse(raw);
      return {
        file_name: String(parsed.file_name || ''),
        loaded_at: parsed.loaded_at || null,
        last_sync_at: parsed.last_sync_at || null,
        location_label: String(parsed.location_label || 'Path unavailable in this browser (security restriction)'),
        log: Array.isArray(parsed.log) ? parsed.log.slice(0, 20) : []
      };
    } catch (e) {
      return { file_name: '', loaded_at: null, last_sync_at: null, location_label: 'Path unavailable in this browser (security restriction)', log: [] };
    }
  }

  function _writePersistentMeta(meta) {
    localStorage.setItem(PERSISTENT_META_KEY, JSON.stringify(meta));
  }

  function _appendPersistentLog(message) {
    const meta = _readPersistentMeta();
    const nextLog = [{ at: _now(), message: String(message || '') }].concat(meta.log || []).slice(0, 20);
    _writePersistentMeta({ ...meta, log: nextLog });
  }

  function _normalizeLogTimestampInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = raw.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) return `${normalized}:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) return normalized;
    return '';
  }

  function _deriveLocationLabel(handle, file) {
    const directPath = [handle && handle.path, handle && handle.fullPath, file && file.path, file && file.fullPath]
      .find(v => typeof v === 'string' && v.trim());
    if (directPath) return String(directPath);
    const relativePath = file && typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath.trim() : '';
    if (relativePath) return relativePath;
    return 'Path unavailable in this browser (security restriction)';
  }

  function getPersistentLogEntries(filters = {}) {
    const meta = _readPersistentMeta();
    const year = Number(filters.year);
    const from = _normalizeLogTimestampInput(filters.from);
    const to = _normalizeLogTimestampInput(filters.to);
    const search = String(filters.search || '').trim().toLowerCase();
    let rows = Array.isArray(meta.log) ? meta.log.slice() : [];
    rows = rows.map(row => ({
      at: String(row && row.at ? row.at : ''),
      message: String(row && row.message ? row.message : '')
    })).filter(row => row.at || row.message);
    if (Number.isInteger(year) && year > 0) rows = rows.filter(row => row.at.startsWith(`${year}-`));
    if (from) rows = rows.filter(row => row.at && row.at >= from);
    if (to) rows = rows.filter(row => row.at && row.at <= to);
    if (search) rows = rows.filter(row => `${row.at} ${row.message}`.toLowerCase().includes(search));
    return rows;
  }

  function clearPersistentLogEntries() {
    const meta = _readPersistentMeta();
    _writePersistentMeta({ ...meta, log: [] });
    if (persistentExcel.enabled && persistentExcel.handle) _queuePersistentSync();
    _emitPersistentExcelStatus();
    return _getPersistentExcelStatus();
  }

  function _openHandleDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
    });
  }

  function _dbGet(store, key) {
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
    });
  }

  function _dbPut(store, value, key) {
    return new Promise((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('IndexedDB put failed'));
    });
  }

  function _dbDelete(store, key) {
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
    });
  }

  async function _storePersistentHandle(handle) {
    const db = await _openHandleDb();
    try {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      const store = tx.objectStore(HANDLE_STORE);
      await _dbPut(store, handle, HANDLE_ID);
    } finally {
      db.close();
    }
  }

  async function _loadPersistentHandle() {
    const db = await _openHandleDb();
    try {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const store = tx.objectStore(HANDLE_STORE);
      return await _dbGet(store, HANDLE_ID);
    } finally {
      db.close();
    }
  }

  async function _clearPersistentHandle() {
    const db = await _openHandleDb();
    try {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      const store = tx.objectStore(HANDLE_STORE);
      await _dbDelete(store, HANDLE_ID);
    } finally {
      db.close();
    }
  }

  function _toISODate(value) {
    const str = String(value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) throw new Error('Invalid date');
    return str;
  }

  function _lastDayOfMonth(year, month) {
    return new Date(Number(year), Number(month), 0).getDate();
  }

  function _toMonthKey(year, month) {
    return Number(year) * 100 + Number(month);
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

  function _searchFilter(rows, categoriesById, search) {
    const needle = String(search || '').trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(e => {
      const cat = (categoriesById[Number(e.category_id)] || {}).name || '';
      const notes = String(e.notes || '');
      return `${cat} ${notes}`.toLowerCase().includes(needle);
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
    const categoryById = {};
    categories.forEach(c => { categoryById[Number(c.id)] = c; });
    if (filters.category) rows = rows.filter(e => Number(e.category_id) === Number(filters.category));
    rows = _searchFilter(rows, categoryById, filters.search);
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

  function insertExpenditure({ date, category_id, amount, notes, type }) {
    const data = _read();
    const id = _nextId(data.expenditures);
    const txnType = _normalizeTxnType(type);
    const othersId = _findOthersCategoryId(data.categories);
    const finalCategoryId = txnType === 'credit' && Number.isFinite(othersId)
      ? Number(othersId)
      : Number(category_id);
    data.expenditures.push({
      id, date: String(date), category_id: finalCategoryId,
      amount: Number(amount), notes: notes || '', type: txnType, created_at: _now()
    });
    _write(data);
    return id;
  }

  function updateExpenditure(id, { date, category_id, amount, notes, type }) {
    const data = _read();
    const othersId = _findOthersCategoryId(data.categories);
    data.expenditures = data.expenditures.map(e =>
      Number(e.id) === Number(id) ? (() => {
        const txnType = _normalizeTxnType(type || e.type);
        const finalCategoryId = txnType === 'credit' && Number.isFinite(othersId)
          ? Number(othersId)
          : Number(category_id);
        return { ...e, date: String(date), category_id: finalCategoryId, amount: Number(amount), notes: notes || '', type: txnType };
      })() : e
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
    let rows = _dateFilter(expenditures, filters).filter(e => _normalizeTxnType(e.type) === 'debit');
    const categoryById = {};
    categories.forEach(c => { categoryById[Number(c.id)] = c; });
    if (filters.category) rows = rows.filter(e => Number(e.category_id) === Number(filters.category));
    rows = _searchFilter(rows, categoryById, filters.search);
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

  // ── Cashflow (opening cash + monthly salary log) ────────────────────

  function _defaultCashflow() {
    return {
      opening_cash: { amount: 0, effective_date: _todayISO(), updated_at: _now() },
      monthly_incomes: []
    };
  }

  function _normalizeMonthlyIncomeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(r => {
      const dateCandidate = String(r.received_date || r.date || '');
      const hasValidDate = /^\d{4}-\d{2}-\d{2}$/.test(dateCandidate);
      const yearFromDate = hasValidDate ? Number(dateCandidate.slice(0, 4)) : NaN;
      const monthFromDate = hasValidDate ? Number(dateCandidate.slice(5, 7)) : NaN;
      const year = Number.isInteger(Number(r.year)) ? Number(r.year) : yearFromDate;
      const month = Number.isInteger(Number(r.month)) ? Number(r.month) : monthFromDate;
      const day = hasValidDate ? dateCandidate.slice(8, 10) : '01';
      const received_date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day)}`;
      return {
        id: Number(r.id),
        year,
        month,
        amount: Number(r.amount),
        received_date,
        notes: String(r.notes || ''),
        created_at: r.created_at || _now(),
        updated_at: r.updated_at || _now()
      };
    }).filter(r =>
      Number.isFinite(r.id) &&
      Number.isInteger(r.year) &&
      r.year >= 1900 &&
      r.year <= 9999 &&
      Number.isInteger(r.month) &&
      r.month >= 1 &&
      r.month <= 12 &&
      Number.isFinite(r.amount) &&
      r.amount > 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.received_date)
    );
  }

  function _migrateLegacyIncomes(parsed) {
    const today = _todayISO();
    const monthTotals = {};
    const addToMonth = (date, amount) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return;
      const key = String(date).slice(0, 7);
      monthTotals[key] = (monthTotals[key] || 0) + Number(amount || 0);
    };

    (Array.isArray(parsed.incomes) ? parsed.incomes : []).forEach(i => {
      const amount = Number(i.amount);
      if (!Number.isFinite(amount) || amount <= 0) return;
      addToMonth(i.date, amount);
    });

    (Array.isArray(parsed.recurring_incomes) ? parsed.recurring_incomes : []).forEach(rule => {
      const amount = Number(rule.amount);
      const y = Number(rule.start_year);
      const m = Number(rule.start_month);
      const d = Number(rule.day_of_month);
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return;
      if (m < 1 || m > 12 || d < 1 || d > 28) return;
      let cy = y;
      let cm = m;
      let guard = 0;
      while (guard < 2400) {
        const day = String(Math.min(d, _lastDayOfMonth(cy, cm))).padStart(2, '0');
        const date = `${String(cy).padStart(4, '0')}-${String(cm).padStart(2, '0')}-${day}`;
        if (date > today) break;
        addToMonth(date, amount);
        cm += 1;
        if (cm > 12) { cm = 1; cy += 1; }
        guard += 1;
      }
    });

    const monthlyRows = Object.keys(monthTotals).map((key, idx) => {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(5, 7));
      const last = String(_lastDayOfMonth(year, month)).padStart(2, '0');
      return {
        id: idx + 1,
        year,
        month,
        amount: monthTotals[key],
        received_date: `${key}-${last}`,
        notes: 'Migrated from legacy income data',
        created_at: _now(),
        updated_at: _now()
      };
    });
    return _normalizeMonthlyIncomeRows(monthlyRows);
  }

  function _readCashflow() {
    if (cashflowCache) return cashflowCache;
    try {
      const raw = localStorage.getItem(CASHFLOW_KEY);
      if (!raw) {
        cashflowCache = _defaultCashflow();
        return cashflowCache;
      }
      const parsed = JSON.parse(raw);
      const opening = parsed && parsed.opening_cash ? parsed.opening_cash : {};
      const openingAmount = Number(opening.amount);
      const openingDate = String(opening.effective_date || _todayISO());
      const monthlyRaw = Array.isArray(parsed.monthly_incomes) && parsed.monthly_incomes.length
        ? parsed.monthly_incomes
        : _migrateLegacyIncomes(parsed);
      cashflowCache = {
        opening_cash: {
          amount: Number.isFinite(openingAmount) && openingAmount >= 0 ? openingAmount : 0,
          effective_date: /^\d{4}-\d{2}-\d{2}$/.test(openingDate) ? openingDate : _todayISO(),
          updated_at: opening.updated_at || _now()
        },
        monthly_incomes: _normalizeMonthlyIncomeRows(monthlyRaw)
      };
      return cashflowCache;
    } catch (e) {
      cashflowCache = _defaultCashflow();
      return cashflowCache;
    }
  }

  function _writeCashflow(cashflow) {
    cashflowCache = cashflow;
    if (persistentExcel.enabled && persistentExcel.handle) {
      _queuePersistentSync();
      return;
    }
    localStorage.setItem(CASHFLOW_KEY, JSON.stringify(cashflow));
    _queuePersistentSync();
  }

  function _monthlyIncomeRows(cashflow) {
    return cashflow.monthly_incomes.map(row => ({
      id: row.id,
      date: row.received_date,
      amount: Number(row.amount),
      year: Number(row.year),
      month: Number(row.month),
      notes: row.notes || ''
    }));
  }

  function setOpeningCash(amount, effective_date) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid opening cash amount');
    const date = _toISODate(effective_date || _todayISO());
    const cashflow = _readCashflow();
    cashflow.opening_cash = { amount: n, effective_date: date, updated_at: _now() };
    _writeCashflow(cashflow);
  }

  function getOpeningCash() {
    const cashflow = _readCashflow();
    return { ...cashflow.opening_cash };
  }

  function setMonthlyIncome({ year, month, amount, received_date, notes = '' }) {
    const y = Number(year);
    const m = Number(month);
    const n = Number(amount);
    if (!Number.isInteger(y) || y < 1900 || y > 9999) throw new Error('Invalid year');
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Invalid month');
    if (!Number.isFinite(n) || n < 1) throw new Error('Invalid salary amount');
    const isoDate = _toISODate(received_date || `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`);
    if (Number(isoDate.slice(0, 4)) !== y || Number(isoDate.slice(5, 7)) !== m) {
      throw new Error('Received date must be in selected month');
    }
    const cashflow = _readCashflow();
    const idx = cashflow.monthly_incomes.findIndex(r => Number(r.year) === y && Number(r.month) === m);
    const next = {
      id: idx >= 0 ? Number(cashflow.monthly_incomes[idx].id) : _nextId(cashflow.monthly_incomes),
      year: y,
      month: m,
      amount: n,
      received_date: isoDate,
      notes: String(notes || '').trim(),
      created_at: idx >= 0 ? cashflow.monthly_incomes[idx].created_at : _now(),
      updated_at: _now()
    };
    if (idx >= 0) cashflow.monthly_incomes[idx] = next;
    else cashflow.monthly_incomes.push(next);
    _writeCashflow(cashflow);
    return next.id;
  }

  function deleteMonthlyIncome(id) {
    const cashflow = _readCashflow();
    const numId = Number(id);
    const before = cashflow.monthly_incomes.length;
    cashflow.monthly_incomes = cashflow.monthly_incomes.filter(r => Number(r.id) !== numId);
    if (cashflow.monthly_incomes.length === before) throw new Error('Monthly salary entry not found');
    _writeCashflow(cashflow);
  }

  function getMonthlyIncomes(filters = {}) {
    const cashflow = _readCashflow();
    const y = filters.year ? Number(filters.year) : null;
    const m = filters.month ? Number(filters.month) : null;
    return cashflow.monthly_incomes
      .filter(r => (!y || Number(r.year) === y) && (!m || Number(r.month) === m))
      .sort((a, b) => (Number(b.year) - Number(a.year)) || (Number(b.month) - Number(a.month)));
  }

  function getMonthlyCashLog() {
    const cashflow = _readCashflow();
    const incomeMap = {};
    cashflow.monthly_incomes.forEach(r => {
      const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
      incomeMap[key] = Number(r.amount);
    });
    const expenseMap = {};
    _read().expenditures.forEach(e => {
      if (_normalizeTxnType(e.type) !== 'debit') return;
      const d = String(e.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const key = d.slice(0, 7);
      expenseMap[key] = (expenseMap[key] || 0) + Number(e.amount);
    });

    const keys = Array.from(new Set(Object.keys(incomeMap).concat(Object.keys(expenseMap))));
    return keys.map(key => {
      const year = Number(key.slice(0, 4));
      const month = Number(key.slice(5, 7));
      const income = Number(incomeMap[key] || 0);
      const expense = Number(expenseMap[key] || 0);
      return {
        key,
        year,
        month,
        income,
        transactions_total: expense,
        net: income - expense
      };
    }).sort((a, b) => (b.year - a.year) || (b.month - a.month));
  }

  function getCashPosition(filters = {}) {
    const cashflow = _readCashflow();
    const opening = Number(cashflow.opening_cash.amount || 0);
    const openingDate = String(cashflow.opening_cash.effective_date || _todayISO());
    const asOf = _todayISO();
    const incomeRows = _monthlyIncomeRows(cashflow);
    const creditRowsToDate = _read().expenditures
      .filter(e => _normalizeTxnType(e.type) === 'credit')
      .map(e => ({ date: String(e.date || ''), amount: Number(e.amount) }));

    const incomesToDate = incomeRows
      .concat(creditRowsToDate)
      .filter(i => i.date >= openingDate && i.date <= asOf);
    const expensesToDate = _read().expenditures.filter(e =>
      _normalizeTxnType(e.type) === 'debit' &&
      String(e.date || '') >= openingDate &&
      String(e.date || '') <= asOf
    );
    const totalIncomeToDate = incomesToDate.reduce((s, i) => s + Number(i.amount), 0);
    const totalExpenseToDate = expensesToDate.reduce((s, e) => s + Number(e.amount), 0);

    const periodIncomeRows = _dateFilter(incomeRows, filters).concat(
      _dateFilter(_read().expenditures, filters)
        .filter(e => _normalizeTxnType(e.type) === 'credit')
        .map(e => ({ amount: Number(e.amount) }))
    );
    const periodExpenseRows = _dateFilter(_read().expenditures, filters).filter(e => _normalizeTxnType(e.type) === 'debit');
    const periodIncome = periodIncomeRows.reduce((s, i) => s + Number(i.amount), 0);
    const periodExpense = periodExpenseRows.reduce((s, e) => s + Number(e.amount), 0);

    return {
      opening_cash: opening,
      opening_effective_date: openingDate,
      as_of_date: asOf,
      total_income_to_date: totalIncomeToDate,
      total_expense_to_date: totalExpenseToDate,
      current_cash: opening + totalIncomeToDate - totalExpenseToDate,
      period_income: periodIncome,
      period_expense: periodExpense,
      period_net: periodIncome - periodExpense
    };
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
      if (_normalizeTxnType(e.type) !== 'debit') return false;
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

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function _goalId(year, month) {
    return Number(year) * 100 + Number(month);
  }

  function _normalizeYearMonth(year, month) {
    const now = _istNowYearMonthDay();
    const y = Number(year || now.year);
    const m = Number(month || now.month);
    if (!Number.isInteger(y) || y < 1900 || y > 9999) throw new Error('Invalid year');
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new Error('Invalid month');
    return { year: y, month: m };
  }

  function _readGoals() {
    if (goalsCache) return goalsCache;
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
          goalsCache = _ensureCurrentMonthGoal(normalized);
          return goalsCache;
        }
      }
    } catch (e) { /* ignore bad payload */ }

    // One-time legacy migration: old single-value monthly goal -> current month
    const legacy = localStorage.getItem(LEGACY_GOAL_KEY);
    if (legacy !== null && legacy !== '') {
      const amount = Number(legacy);
      if (Number.isFinite(amount) && amount > 0) {
        const now = _istNowYearMonthDay();
        const migrated = [{
          id: _goalId(now.year, now.month),
          year: now.year,
          month: now.month,
          amount,
          updated_at: _now()
        }];
        if (!persistentExcel.enabled || !persistentExcel.handle) {
          localStorage.setItem(GOAL_KEY, JSON.stringify(migrated));
          localStorage.removeItem(LEGACY_GOAL_KEY);
        }
        goalsCache = _ensureCurrentMonthGoal(migrated);
        return goalsCache;
      }
      if (!persistentExcel.enabled || !persistentExcel.handle) localStorage.removeItem(LEGACY_GOAL_KEY);
    }
    goalsCache = _ensureCurrentMonthGoal([]);
    return goalsCache;
  }

  function _writeGoals(goals) {
    goalsCache = goals;
    if (persistentExcel.enabled && persistentExcel.handle) {
      _queuePersistentSync();
      return;
    }
    localStorage.setItem(GOAL_KEY, JSON.stringify(goals));
    _queuePersistentSync();
  }

  function _previousYearMonth(year, month) {
    if (month === 1) return { year: year - 1, month: 12 };
    return { year, month: month - 1 };
  }

  function _ensureCurrentMonthGoal(goals) {
    const now = _istNowYearMonthDay();
    const y = now.year;
    const m = now.month;
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

    const now = _istNowYearMonthDay();
    const curr = goals.find(g => g.year === now.year && g.month === now.month);
    return curr ? Number(curr.amount) : null;
  }

  function getGoalScopeLabel(filters = {}) {
    const hasYear = !!filters.year;
    const hasMonth = !!filters.month;
    if (hasYear && hasMonth) return `${MONTH_NAMES[Number(filters.month) - 1]} ${filters.year}`;
    if (hasYear) return `Year ${filters.year}`;
    if (hasMonth) return `${MONTH_NAMES[Number(filters.month) - 1]} (All Years)`;
    const now = _istNowYearMonthDay();
    return `${MONTH_NAMES[now.month - 1]} ${now.year}`;
  }

  function _buildWorkbook() {
    const { categories, expenditures, spending_limits } = _read();
    const budget_goals = _readGoals();
    const cashflow = _readCashflow();
    const persistentMeta = _readPersistentMeta();
    const persistentRows = (Array.isArray(persistentMeta.log) ? persistentMeta.log : []).map(row => ({
      at: row && row.at ? String(row.at) : '',
      message: row && row.message ? String(row.message) : '',
      file_name: persistentMeta.file_name || '',
      location_label: persistentMeta.location_label || '',
      loaded_at: persistentMeta.loaded_at || '',
      last_sync_at: persistentMeta.last_sync_at || ''
    }));
    const wb = XLSX.utils.book_new();
    const add = (name, rows, hdr) => {
      const ws = rows.length ? XLSX.utils.json_to_sheet(rows, { header: hdr }) : XLSX.utils.aoa_to_sheet([hdr]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add('Categories',     categories,      ['id', 'name', 'color', 'created_at']);
    add('Expenditures',   expenditures,    ['id', 'date', 'category_id', 'amount', 'type', 'notes', 'created_at']);
    add('SpendingLimits', spending_limits, ['id', 'category_id', 'monthly_limit']);
    add('BudgetGoals',    budget_goals,    ['id', 'year', 'month', 'amount', 'updated_at']);
    add('CashOpening',    [cashflow.opening_cash], ['amount', 'effective_date', 'updated_at']);
    add('MonthlyIncomes', cashflow.monthly_incomes, ['id', 'year', 'month', 'amount', 'received_date', 'notes', 'created_at', 'updated_at']);
    add('PersistentLog',  persistentRows, ['at', 'message', 'file_name', 'location_label', 'loaded_at', 'last_sync_at']);
    return wb;
  }

  function _normalizeExpenditureRows(rows) {
    return _normalizeExpenditures(rows).normalized;
  }

  function _normalizePersistentLogRows(rows) {
    return (Array.isArray(rows) ? rows : [])
      .map(r => ({
        at: String(r.at || '').trim(),
        message: String(r.message || '').trim()
      }))
      .filter(r => r.at || r.message)
      .slice(0, 20);
  }

  function _importFromWorkbook(wb) {
    const toRows = n => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null }) : [];
    const data = {
      categories:      toRows('Categories'),
      expenditures:    toRows('Expenditures'),
      spending_limits: toRows('SpendingLimits')
    };
    const hasBudgetGoalsSheet = !!wb.Sheets.BudgetGoals;
    const budgetGoals = toRows('BudgetGoals');
    const hasCashOpeningSheet = !!wb.Sheets.CashOpening;
    const hasMonthlyIncomesSheet = !!wb.Sheets.MonthlyIncomes;
    const hasIncomesSheet = !!wb.Sheets.Incomes;
    const hasRecurringIncomesSheet = !!wb.Sheets.RecurringIncomes;
    const hasPersistentLogSheet = !!wb.Sheets.PersistentLog;
    const cashOpeningRows = toRows('CashOpening');
    const monthlyIncomesRows = toRows('MonthlyIncomes');
    const incomesRows = toRows('Incomes');
    const recurringIncomeRows = toRows('RecurringIncomes');
    const persistentLogRows = toRows('PersistentLog');
    if (!Array.isArray(data.categories)) throw new Error('Invalid file format');
    const { normalized } = _normalizeCategories(data.categories);
    data.categories = normalized;
    data.expenditures = _normalizeExpenditureRows(data.expenditures);
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
    if (hasCashOpeningSheet || hasMonthlyIncomesSheet || hasIncomesSheet || hasRecurringIncomesSheet) {
      const existing = _readCashflow();
      const openingInput = Array.isArray(cashOpeningRows) && cashOpeningRows.length ? cashOpeningRows[0] : existing.opening_cash;
      const openingAmount = Number(openingInput.amount);
      const openingDate = String(openingInput.effective_date || existing.opening_cash.effective_date || _todayISO());
      const legacySource = { incomes: incomesRows, recurring_incomes: recurringIncomeRows };
      const legacyMigrated = _migrateLegacyIncomes(legacySource);
      const monthlyRows = hasMonthlyIncomesSheet
        ? _normalizeMonthlyIncomeRows(monthlyIncomesRows)
        : legacyMigrated;
      const normalizedCashflow = {
        opening_cash: {
          amount: Number.isFinite(openingAmount) && openingAmount >= 0 ? openingAmount : 0,
          effective_date: /^\d{4}-\d{2}-\d{2}$/.test(openingDate) ? openingDate : _todayISO(),
          updated_at: openingInput.updated_at || _now()
        },
        monthly_incomes: monthlyRows.length ? monthlyRows : existing.monthly_incomes
      };
      _writeCashflow(normalizedCashflow);
    }
    if (hasPersistentLogSheet) {
      const normalizedLog = _normalizePersistentLogRows(persistentLogRows);
      const firstMetaRow = (Array.isArray(persistentLogRows) ? persistentLogRows : []).find(r =>
        r && (r.file_name || r.location_label || r.loaded_at || r.last_sync_at)
      ) || {};
      const prevMeta = _readPersistentMeta();
      _writePersistentMeta({
        file_name: String(firstMetaRow.file_name || prevMeta.file_name || ''),
        loaded_at: firstMetaRow.loaded_at || prevMeta.loaded_at || null,
        last_sync_at: firstMetaRow.last_sync_at || prevMeta.last_sync_at || null,
        location_label: String(firstMetaRow.location_label || prevMeta.location_label || persistentExcel.location_label),
        log: normalizedLog
      });
    }
  }

  async function _ensureFilePermission(handle) {
    if (!handle || typeof handle.queryPermission !== 'function' || typeof handle.requestPermission !== 'function') return;
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('File permission denied');
  }

  async function _saveAllToPersistentFile() {
    if (!persistentExcel.enabled || !persistentExcel.handle) return;
    if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');
    await _ensureFilePermission(persistentExcel.handle);
    const wb = _buildWorkbook();
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const writable = await persistentExcel.handle.createWritable();
    await writable.write(wbout);
    await writable.close();
    persistentExcel.last_sync_at = _now();
    persistentExcel.last_error = '';
    const meta = _readPersistentMeta();
    _writePersistentMeta({
      ...meta,
      file_name: persistentExcel.handle ? persistentExcel.handle.name : meta.file_name,
      loaded_at: persistentExcel.loaded_at || meta.loaded_at,
      last_sync_at: persistentExcel.last_sync_at,
      location_label: meta.location_label || persistentExcel.location_label,
      log: meta.log || []
    });
  }

  async function _flushPersistentSync() {
    if (!persistentExcel.enabled || !persistentExcel.handle || persistentExcel.syncing) return;
    if (!persistentExcel.pending) return;
    persistentExcel.syncing = true;
    persistentExcel.pending = false;
    _emitPersistentExcelStatus();
    try {
      await _saveAllToPersistentFile();
      _appendPersistentLog(`Synced to ${persistentExcel.handle ? persistentExcel.handle.name : 'linked file'}`);
    } catch (e) {
      persistentExcel.last_error = e && e.message ? e.message : 'Failed to sync persistent file';
      _appendPersistentLog(`Sync failed: ${persistentExcel.last_error}`);
    } finally {
      persistentExcel.syncing = false;
      _emitPersistentExcelStatus();
      if (persistentExcel.pending) _flushPersistentSync();
    }
  }

  function _queuePersistentSync() {
    if (!persistentExcel.enabled || !persistentExcel.handle) return;
    if (persistentExcel.importing) return;
    persistentExcel.pending = true;
    _emitPersistentExcelStatus();
    setTimeout(() => { _flushPersistentSync(); }, 0);
  }

  async function connectPersistentExcelFile() {
    if (!_isPersistentExcelSupported()) throw new Error('Persistent Excel mode is not supported in this browser');
    if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');
    const picks = await window.showOpenFilePicker({
      types: [{ description: 'Excel Workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }],
      multiple: false
    });
    const handle = picks[0];
    await _ensureFilePermission(handle);
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    persistentExcel.enabled = true;
    persistentExcel.handle = handle;
    persistentExcel.loaded_at = _now();
    persistentExcel.location_label = _deriveLocationLabel(handle, file);
    persistentExcel.importing = true;
    _importFromWorkbook(wb);
    persistentExcel.importing = false;
    persistentExcel.last_error = '';
    await _storePersistentHandle(handle);
    _writePersistentMeta({
      file_name: handle.name || '',
      loaded_at: persistentExcel.loaded_at,
      last_sync_at: persistentExcel.last_sync_at,
      location_label: persistentExcel.location_label,
      log: _readPersistentMeta().log || []
    });
    _appendPersistentLog(`Linked file: ${handle.name || 'finance.xlsx'} (${persistentExcel.location_label})`);
    await _saveAllToPersistentFile();
    _emitPersistentExcelStatus();
    return _getPersistentExcelStatus();
  }

  async function syncPersistentExcelNow() {
    if (!persistentExcel.enabled || !persistentExcel.handle) throw new Error('Persistent Excel mode is not enabled');
    await _saveAllToPersistentFile();
    _appendPersistentLog(`Manual sync: ${persistentExcel.handle ? persistentExcel.handle.name : 'linked file'}`);
    _emitPersistentExcelStatus();
    return _getPersistentExcelStatus();
  }

  async function initializePersistentExcelLink() {
    const meta = _readPersistentMeta();
    if (!meta.file_name) {
      _emitPersistentExcelStatus();
      return _getPersistentExcelStatus();
    }
    if (typeof XLSX === 'undefined') {
      _emitPersistentExcelStatus();
      return _getPersistentExcelStatus();
    }
    try {
      const handle = await _loadPersistentHandle();
      if (!handle || typeof handle.getFile !== 'function') {
        _emitPersistentExcelStatus();
        return _getPersistentExcelStatus();
      }
      const permission = typeof handle.queryPermission === 'function'
        ? await handle.queryPermission({ mode: 'readwrite' })
        : 'prompt';
      if (permission !== 'granted') {
        _emitPersistentExcelStatus();
        return _getPersistentExcelStatus();
      }
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      persistentExcel.enabled = true;
      persistentExcel.handle = handle;
      persistentExcel.loaded_at = meta.loaded_at || _now();
      persistentExcel.location_label = _deriveLocationLabel(handle, file) || meta.location_label || 'Path unavailable in this browser (security restriction)';
      persistentExcel.importing = true;
      _importFromWorkbook(wb);
      persistentExcel.importing = false;
      persistentExcel.last_error = '';
      _appendPersistentLog(`Reconnected file: ${handle.name || meta.file_name}`);
    } catch (e) {
      persistentExcel.enabled = false;
      persistentExcel.handle = null;
      persistentExcel.importing = false;
      persistentExcel.syncing = false;
      persistentExcel.pending = false;
      persistentExcel.last_error = e && e.message ? e.message : 'Failed to reconnect linked file';
      _appendPersistentLog(`Reconnect failed: ${persistentExcel.last_error}`);
    }
    _emitPersistentExcelStatus();
    return _getPersistentExcelStatus();
  }

  function _persistCachesToLocalStorage() {
    if (storeCache) localStorage.setItem(STORE_KEY, JSON.stringify(storeCache));
    if (goalsCache) localStorage.setItem(GOAL_KEY, JSON.stringify(goalsCache));
    if (cashflowCache) localStorage.setItem(CASHFLOW_KEY, JSON.stringify(cashflowCache));
  }

  async function disconnectPersistentExcelFile() {
    _persistCachesToLocalStorage();
    const linkedName = persistentExcel.handle ? persistentExcel.handle.name : (_readPersistentMeta().file_name || 'linked file');
    persistentExcel.enabled = false;
    persistentExcel.handle = null;
    persistentExcel.syncing = false;
    persistentExcel.importing = false;
    persistentExcel.pending = false;
    persistentExcel.last_error = '';
    persistentExcel.loaded_at = null;
    await _clearPersistentHandle();
    const meta = _readPersistentMeta();
    _writePersistentMeta({
      ...meta,
      file_name: '',
      loaded_at: null
    });
    _appendPersistentLog(`Disconnected file: ${linkedName}`);
    _emitPersistentExcelStatus();
    return _getPersistentExcelStatus();
  }

  function getPersistentExcelStatus() {
    return _getPersistentExcelStatus();
  }

  // ── Excel Export ───────────────────────────────────────────────────

  function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('SheetJS not loaded. Check your internet connection.'); return; }
    const wb = _buildWorkbook();

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
    file.arrayBuffer()
      .then(buf => {
        const wb = XLSX.read(buf, { type: 'array' });
        _importFromWorkbook(wb);
        if (callback) callback(null);
      })
      .catch(err => {
        if (callback) callback(err);
      });
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
    getOpeningCash,
    setOpeningCash,
    setMonthlyIncome,
    deleteMonthlyIncome,
    getMonthlyIncomes,
    getMonthlyCashLog,
    getCashPosition,
    getPersistentExcelStatus,
    getPersistentLogEntries,
    clearPersistentLogEntries,
    initializePersistentExcelLink,
    connectPersistentExcelFile,
    syncPersistentExcelNow,
    disconnectPersistentExcelFile,
    exportToExcel,
    importFromExcel,
    getGeneralGoal,
    setGeneralGoal,
    getBudgetGoals,
    getGoalScopeLabel
  };

  initializePersistentExcelLink().catch(() => { /* status is emitted by initializer */ });
})();
