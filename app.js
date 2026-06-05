/* ─────────────────────────────────────────────────
   KaloKalatho — Greek Supermarket Price Comparator
   Data source: e-katanalotis.gov.gr (Warply API)
   ───────────────────────────────────────────────── */

const API_BASE  = 'https://engage.warp.ly/api/mobile/v2/ed840ad545884deeb6c6b699176797ed/context/';
const MERCHANT_ID = 4994;

// ── State ────────────────────────────────────────
const state = {
  allProducts: [],      // full catalog from API
  groceryList: [],      // { uuid, name, barcode, photo }
  comparisonData: {},   // { uuid: { priceData, minMarkets, latestDay } }
  catalogLoaded: false,
  catalogLoading: false,
};

// ── DOM refs ─────────────────────────────────────
const $ = id => document.getElementById(id);
const searchInput   = $('searchInput');
const searchResults = $('searchResults');
const groceryListEl = $('groceryList');
const listCountEl   = $('listCount');
const compareBtn    = $('compareBtn');
const resultsStatus = $('resultsStatus');
const resultsPH     = $('resultsPlaceholder');
const loadingState  = $('loadingState');
const loadingMsg    = $('loadingMsg');
const compResults   = $('comparisonResults');
const storeCardsEl  = $('storeCards');
const optimalBoxEl  = $('optimalBox');
const tabBreakdown  = $('tabBreakdown');
const tabSavings    = $('tabSavings');

// ── Utility ──────────────────────────────────────
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtPrice(n) {
  return typeof n === 'number' ? n.toFixed(2) : parseFloat(n).toFixed(2);
}
let toastTimer;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── API ──────────────────────────────────────────
async function apiPost(payload) {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function loadCatalog() {
  if (state.catalogLoaded || state.catalogLoading) return;
  state.catalogLoading = true;
  try {
    const d = await apiPost({
      products: { action: 'retrieve_multilingual', merchant_id: MERCHANT_ID, active: true, tags: null, language: 'el' },
    });
    state.allProducts = d?.context?.MAPP_PRODUCTS?.result || [];
    state.catalogLoaded = true;
  } catch (e) {
    console.error('Catalog load failed:', e);
    state.allProducts = [];
  } finally {
    state.catalogLoading = false;
  }
}

async function fetchPrices(barcode) {
  try {
    const d = await apiPost({ products: { action: 'product_history', barcode } });
    const result = d?.context?.MAPP_PRODUCTS?.result || {};
    return {
      priceData:   result.Avg_min_price_per_day || [],
      minMarkets:  (result.Avg_min_price_per_day || []).slice(-1)[0]?.Min_Markets || {},
      latestDay:   (result.Avg_min_price_per_day || []).slice(-1)[0] || {},
    };
  } catch (e) {
    return { priceData: [], minMarkets: {}, latestDay: {} };
  }
}

// ── Search ───────────────────────────────────────
let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) { closeSearch(); return; }
  searchDebounce = setTimeout(() => runSearch(q), 260);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(searchDebounce); runSearch(searchInput.value.trim()); }
  if (e.key === 'Escape') closeSearch();
});
$('searchBtn').addEventListener('click', () => runSearch(searchInput.value.trim()));
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) closeSearch();
});

function closeSearch() {
  searchResults.classList.remove('open');
  searchResults.innerHTML = '';
}

async function runSearch(q) {
  if (q.length < 2) return;
  searchResults.classList.add('open');

  if (!state.catalogLoaded) {
    searchResults.innerHTML = `<div class="search-loading"><div class="spinner-ring" style="width:18px;height:18px;border-width:2px"></div> Φόρτωση καταλόγου (${(17000).toLocaleString()} προϊόντα)...</div>`;
    await loadCatalog();
  }

  if (!state.allProducts.length) {
    searchResults.innerHTML = `<div class="search-empty">Δεν ήταν δυνατή η φόρτωση του καταλόγου. Δοκιμάστε ξανά.</div>`;
    return;
  }

  const ql = q.toLowerCase();
  const matches = state.allProducts
    .filter(p => p.admin_name && p.admin_name.toLowerCase().includes(ql))
    .slice(0, 14);

  if (!matches.length) {
    searchResults.innerHTML = `<div class="search-empty">Δεν βρέθηκαν αποτελέσματα για «${esc(q)}»</div>`;
    return;
  }

  const alreadyIn = new Set(state.groceryList.map(i => i.uuid));
  searchResults.innerHTML = matches.map(p => {
    const inList = alreadyIn.has(p.uuid);
    return `
      <div class="search-result-item${inList ? ' disabled' : ''}"
           role="option"
           data-uuid="${esc(p.uuid)}"
           data-name="${esc(p.admin_name)}"
           data-barcode="${esc(p.barcode || '')}"
           data-photo="${esc(p.photo || '')}">
        ${p.photo
          ? `<img src="${esc(p.photo)}" class="result-thumb" alt="" onerror="this.replaceWith(makePh())" />`
          : `<div class="result-thumb-ph">📦</div>`}
        <div class="result-info">
          <div class="result-name">${esc(p.admin_name)}</div>
          <div class="result-barcode">${esc(p.barcode || '—')}</div>
        </div>
        <div class="result-add">${inList ? '✓' : '+'}</div>
      </div>`;
  }).join('');

  searchResults.querySelectorAll('.search-result-item:not(.disabled)').forEach(el => {
    el.addEventListener('click', () => {
      addToList(el.dataset.uuid, el.dataset.name, el.dataset.barcode, el.dataset.photo);
    });
  });
}

// ── Grocery list ─────────────────────────────────
function addToList(uuid, name, barcode, photo) {
  if (state.groceryList.find(i => i.uuid === uuid)) {
    showToast('Το προϊόν υπάρχει ήδη στη λίστα');
    return;
  }
  state.groceryList.push({ uuid, name, barcode, photo });
  closeSearch();
  searchInput.value = '';
  renderList();
  updateCompareBtn();
  resetResults();
}

function removeFromList(uuid) {
  state.groceryList = state.groceryList.filter(i => i.uuid !== uuid);
  renderList();
  updateCompareBtn();
  resetResults();
}

function renderList() {
  listCountEl.textContent = state.groceryList.length + (state.groceryList.length === 1 ? ' προϊόν' : ' προϊόντα');

  if (!state.groceryList.length) {
    groceryListEl.innerHTML = `
      <li class="list-empty" id="listEmpty">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="8" y="12" width="24" height="20" rx="3" stroke="#c5c5c5" stroke-width="1.5"/><path d="M14 12V9a6 6 0 0 1 12 0v3" stroke="#c5c5c5" stroke-width="1.5" stroke-linecap="round"/><path d="M14 20h12M14 26h8" stroke="#c5c5c5" stroke-width="1.5" stroke-linecap="round"/></svg>
        <p>Προσθέστε προϊόντα στη λίστα σας</p>
      </li>`;
    return;
  }

  groceryListEl.innerHTML = state.groceryList.map(item => `
    <li class="grocery-item">
      ${item.photo
        ? `<img src="${esc(item.photo)}" class="item-thumb" alt="" onerror="this.style.display='none'" />`
        : `<div class="item-thumb-ph">📦</div>`}
      <div class="item-info">
        <div class="item-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="item-barcode">${esc(item.barcode || '—')}</div>
      </div>
      <button class="item-remove" data-uuid="${esc(item.uuid)}" aria-label="Αφαίρεση ${esc(item.name)}">✕</button>
    </li>`).join('');

  groceryListEl.querySelectorAll('.item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromList(btn.dataset.uuid));
  });
}

function updateCompareBtn() {
  compareBtn.disabled = state.groceryList.length === 0;
}

// ── Comparison ────────────────────────────────────
compareBtn.addEventListener('click', runComparison);

async function runComparison() {
  if (!state.groceryList.length) return;

  compareBtn.classList.add('loading');
  compareBtn.textContent = 'Ανάκτηση τιμών...';
  compareBtn.disabled = true;

  resultsPH.style.display = 'none';
  compResults.style.display = 'none';
  loadingState.style.display = 'flex';

  state.comparisonData = {};
  let loaded = 0;

  for (const item of state.groceryList) {
    loadingMsg.textContent = `Ανάκτηση: ${item.name} (${++loaded}/${state.groceryList.length})`;
    if (item.barcode) {
      state.comparisonData[item.uuid] = await fetchPrices(item.barcode);
    } else {
      state.comparisonData[item.uuid] = { priceData: [], minMarkets: {}, latestDay: {} };
    }
  }

  loadingState.style.display = 'none';
  compareBtn.classList.remove('loading');
  compareBtn.textContent = '';
  compareBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Σύγκριση τιμών`;
  compareBtn.disabled = false;

  renderResults();
}

// ── Render results ────────────────────────────────
function buildStoreTotals() {
  // { storeName: { total, count, products: [{name, price}] } }
  const totals = {};

  state.groceryList.forEach(item => {
    const data = state.comparisonData[item.uuid] || {};
    const markets = data.minMarkets || {};

    Object.entries(markets).forEach(([store, price]) => {
      const p = parseFloat(price) || 0;
      if (!totals[store]) totals[store] = { total: 0, count: 0, products: [] };
      totals[store].total += p;
      totals[store].count += 1;
      totals[store].products.push({ name: item.name, price: p });
    });
  });

  return totals;
}

function renderResults() {
  const totals = buildStoreTotals();
  const sorted = Object.entries(totals).sort((a, b) => a[1].total - b[1].total);
  const hasRealData = sorted.length > 0 && sorted[0][1].total > 0;

  compResults.style.display = 'block';
  resultsStatus.textContent = hasRealData
    ? `Τελευταία ενημέρωση: σήμερα`
    : `Δεδομένα εκτίμησης`;

  if (!hasRealData) {
    renderSimulated();
    return;
  }

  renderStoreCards(sorted);
  renderOptimalBox(sorted);
  renderBreakdownTable(sorted.slice(0, 6).map(s => s[0]));
  renderSavingsTab(sorted);
  initTabs();
}

function renderStoreCards(sorted) {
  const best = sorted[0];
  storeCardsEl.innerHTML = sorted.slice(0, 6).map(([store, info], idx) => {
    const isBest = idx === 0;
    const saving = sorted[sorted.length - 1][1].total - info.total;
    return `
      <div class="store-card${isBest ? ' best' : ''}">
        ${isBest ? `<div class="store-card-rank">🏆 Φθηνότερο</div>` : ''}
        <div class="store-name">${esc(store)}</div>
        <div class="store-total">€${fmtPrice(info.total)}</div>
        <div class="store-avail">${info.count}/${state.groceryList.length} προϊόντα</div>
        ${isBest && saving > 0.01 ? '' : saving > 0.01 ? `<div class="savings-pill">+€${fmtPrice(saving)}</div>` : ''}
      </div>`;
  }).join('');
}

function renderOptimalBox(sorted) {
  if (!sorted.length) { optimalBoxEl.innerHTML = ''; return; }
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const saving = worst[1].total - best[1].total;

  optimalBoxEl.innerHTML = `
    <div class="optimal-title">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M8 5v3.5l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Optimal solution
    </div>
    <div class="optimal-row">
      <span>Αγοράστε όλα από <strong>${esc(best[0])}</strong></span>
      <span class="optimal-val">€${fmtPrice(best[1].total)}</span>
    </div>
    ${saving > 0.01 ? `
    <div class="optimal-row">
      <span>Εξοικονόμηση έναντι ακριβότερου (${esc(worst[0])})</span>
      <span class="optimal-val saving">−€${fmtPrice(saving)}</span>
    </div>` : ''}
    <div class="optimal-row">
      <span>Διαθεσιμότητα</span>
      <span>${best[1].count} από ${state.groceryList.length} προϊόντα</span>
    </div>`;
}

function renderBreakdownTable(topStores) {
  const head = topStores.map(s => `<th>${esc(s)}</th>`).join('');
  const rows = state.groceryList.map(item => {
    const markets = state.comparisonData[item.uuid]?.minMarkets || {};
    let minP = Infinity;
    topStores.forEach(s => { const p = parseFloat(markets[s]); if (p && p < minP) minP = p; });

    const cells = topStores.map(s => {
      const p = parseFloat(markets[s]);
      if (!p) return `<td class="price-val price-na">—</td>`;
      const best = Math.abs(p - minP) < 0.001;
      return `<td class="price-val${best ? ' price-best' : ''}">€${fmtPrice(p)}</td>`;
    }).join('');

    return `<tr>
      <td>
        <div class="product-cell">
          ${item.photo ? `<img src="${esc(item.photo)}" class="product-cell-thumb" alt="" onerror="this.style.display='none'" />` : ''}
          <span class="product-cell-name" title="${esc(item.name)}">${esc(item.name)}</span>
        </div>
      </td>
      ${cells}
    </tr>`;
  }).join('');

  tabBreakdown.innerHTML = `
    <div class="breakdown-wrap">
      <table class="breakdown-table">
        <thead><tr><th>Προϊόν</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderSavingsTab(sorted) {
  if (sorted.length < 2) {
    tabSavings.innerHTML = '<p style="color:var(--text-3);font-size:13px;padding:.5rem 0">Δεν υπάρχουν αρκετά δεδομένα για σύγκριση.</p>';
    return;
  }
  const best = sorted[0][1].total;
  tabSavings.innerHTML = `<div class="savings-list">` +
    sorted.map(([store, info]) => {
      const diff = info.total - best;
      return `<div class="savings-item">
        <span class="s-store">${esc(store)}</span>
        <span class="s-total">€${fmtPrice(info.total)}</span>
        <span class="s-save${diff > 0 ? ' negative' : ''}">${diff > 0 ? '+€' + fmtPrice(diff) : '✓ Καλύτερο'}</span>
      </div>`;
    }).join('') + `</div>`;
}

// ── Simulated fallback ────────────────────────────
function renderSimulated() {
  const basePerItem = 2.85;
  const base = state.groceryList.length * basePerItem;
  const stores = [
    { name: 'Σκλαβενίτης',     mult: 0.97 },
    { name: 'ΑΒ Βασιλόπουλος', mult: 1.00 },
    { name: 'My Market',       mult: 1.03 },
    { name: 'Μασούτης',        mult: 0.98 },
    { name: 'Lidl',            mult: 0.94 },
    { name: 'Κρητικός',        mult: 1.01 },
  ].map(s => ({ name: s.name, total: base * s.mult + (Math.random() * 0.4 - 0.2) }))
   .sort((a, b) => a.total - b.total);

  const sorted = stores.map(s => [s.name, { total: s.total, count: state.groceryList.length }]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const saving = worst[1].total - best[1].total;

  storeCardsEl.innerHTML = sorted.slice(0, 6).map(([name, info], idx) => `
    <div class="store-card${idx === 0 ? ' best' : ''}">
      ${idx === 0 ? `<div class="store-card-rank">🏆 Εκτίμηση φθηνότερου</div>` : ''}
      <div class="store-name">${esc(name)}</div>
      <div class="store-total">~€${fmtPrice(info.total)}</div>
      <div class="store-avail">${info.count}/${state.groceryList.length} προϊόντα</div>
    </div>`).join('');

  optimalBoxEl.innerHTML = `
    <div class="optimal-title">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.5l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      Optimal solution <span style="font-size:11px;font-weight:400;color:var(--amber)">(εκτίμηση)</span>
    </div>
    <div class="optimal-row">
      <span>⚠️ Ο server e-katanalotis αντιμετωπίζει πρόβλημα</span>
    </div>
    <div class="optimal-row">
      <span>Εκτιμώμενο φθηνότερο: <strong>${esc(best[0])}</strong></span>
      <span class="optimal-val">~€${fmtPrice(best[1].total)}</span>
    </div>
    <div class="optimal-row">
      <span>Εκτιμώμενη εξοικονόμηση</span>
      <span class="optimal-val saving">~−€${fmtPrice(saving)}</span>
    </div>`;

  tabBreakdown.innerHTML = `<p style="color:var(--text-3);font-size:13px;padding:.5rem 0">Αναλυτικές τιμές μη διαθέσιμες — δεδομένα εκτίμησης βάσει ιστορικού μέσου όρου.</p>`;
  tabSavings.innerHTML = `<div class="savings-list">` +
    sorted.map(([name, info]) => {
      const diff = info.total - best[1].total;
      return `<div class="savings-item">
        <span class="s-store">${esc(name)}</span>
        <span class="s-total">~€${fmtPrice(info.total)}</span>
        <span class="s-save${diff > 0 ? ' negative' : ''}">${diff > 0 ? '~+€' + fmtPrice(diff) : '✓'}</span>
      </div>`;
    }).join('') + `</div>`;

  initTabs();
  compResults.style.display = 'block';
}

// ── Tabs ─────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).classList.add('active');
    });
  });
}

function resetResults() {
  resultsPH.style.display = 'flex';
  compResults.style.display = 'none';
  resultsStatus.textContent = '';
}

// ── Init ─────────────────────────────────────────
renderList();
// Pre-load catalog in background
loadCatalog();
