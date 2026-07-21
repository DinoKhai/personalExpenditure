/* new-entry.js – Add / Edit expenditure */
const params = new URLSearchParams(window.location.search);
const editId = params.get('edit');
const isEdit = !!editId;

function getOthersCategoryValue() {
  const sel = document.getElementById('field-cat');
  const exact = Array.from(sel.options).find(o => o.textContent.trim().toLowerCase() === 'others');
  if (exact) return exact.value;
  const partial = Array.from(sel.options).find(o => o.textContent.trim().toLowerCase().startsWith('other'));
  return partial ? partial.value : '';
}

function syncCategoryForType() {
  const type = document.getElementById('field-type').value;
  if (type !== 'credit') return;
  const others = getOthersCategoryValue();
  if (others) document.getElementById('field-cat').value = others;
}

function init() {
  const cats = DB.getAllCategories();
  document.getElementById('field-cat').innerHTML =
    '<option value="">— Select category —</option>' +
    cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  setupAmountInput(document.getElementById('field-amount'));

  if (isEdit) {
    document.getElementById('page-heading').textContent = 'Edit Entry';
    document.getElementById('page-sub').textContent     = 'Update this expenditure';
    document.getElementById('submit-btn').textContent   = 'Update Entry';
    loadEntry();
  }
}

function loadEntry() {
  const entry = DB.getExpenditureById(editId);
  if (!entry) { showToast('Entry not found', 'error'); return; }
  document.getElementById('field-date').value   = entry.date;
  document.getElementById('field-cat').value    = entry.category_id;
  document.getElementById('field-amount').value =
    parseFloat(entry.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  document.getElementById('field-notes').value  = entry.notes || '';
  document.getElementById('field-type').value   = entry.type || 'debit';
  syncCategoryForType();
}

document.getElementById('entry-form').addEventListener('submit', e => {
  e.preventDefault();
  let valid = true;

  const date  = document.getElementById('field-date').value;
  const catId = document.getElementById('field-cat').value;
  const txnType = document.getElementById('field-type').value;
  const amt   = getRawAmount(document.getElementById('field-amount'));
  const notes = document.getElementById('field-notes').value.trim();

  const errCat = document.getElementById('err-cat');
  if (!catId) { errCat.classList.add('visible'); valid = false; }
  else errCat.classList.remove('visible');

  const errAmt = document.getElementById('err-amount');
  if (!amt || amt < 1) { errAmt.classList.add('visible'); valid = false; }
  else errAmt.classList.remove('visible');

  if (!valid) return;

  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    if (isEdit) {
      DB.updateExpenditure(editId, { date, category_id: catId, amount: amt, notes, type: txnType });
      showToast('Entry updated ✅');
    } else {
      DB.insertExpenditure({ date, category_id: catId, amount: amt, notes, type: txnType });
      showToast('Entry saved ✅');
      resetForm();
    }
    setTimeout(() => { window.location.href = 'index.html'; }, 900);
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled    = false;
    btn.textContent = isEdit ? 'Update Entry' : 'Save Entry';
  }
});

function resetForm() {
  document.getElementById('field-date').value   = '';
  document.getElementById('field-cat').value    = '';
  document.getElementById('field-amount').value = '';
  document.getElementById('field-notes').value  = '';
  document.getElementById('field-type').value   = 'debit';
  document.getElementById('err-cat').classList.remove('visible');
  document.getElementById('err-amount').classList.remove('visible');
  document.getElementById('submit-btn').disabled    = false;
  document.getElementById('submit-btn').textContent = isEdit ? 'Update Entry' : 'Save Entry';
}

document.getElementById('clear-btn').addEventListener('click', resetForm);
document.getElementById('field-cat').addEventListener('change', () =>
  document.getElementById('err-cat').classList.remove('visible'));
document.getElementById('field-amount').addEventListener('input', () =>
  document.getElementById('err-amount').classList.remove('visible'));
document.getElementById('field-type').addEventListener('change', syncCategoryForType);

init();
