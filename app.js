/* ─────────────────────────────────────────────────────────────
   KaloKalatho — Greek Supermarket Price Comparator
   Data: warply.s3.amazonaws.com  (e-katanalotis.gov.gr)
   2904 products · prices per store · updated every 12h · v4
   ───────────────────────────────────────────────────────────── */

const CID_INTERVAL = 432e5; // 12h cache-busting
const PRICES_URL   = () => {
  const cid = CID_INTERVAL * Math.floor(Date.now() / CID_INTERVAL);
  return `https://warply.s3.amazonaws.com/applications/ed840ad545884deeb6c6b699176797ed/basket-retailers/prices.json?cid=${cid}`;
};
const LS_LIST_KEY = 'kalokalatho_v3';

// ── State ─────────────────────────────────────────────────────
const state = {
  products:     [],    // [{barcode, name, image, prices:[{merchant_uuid, price}], ...}]
  merchants:    {},    // {uuid: {name, display_name}}
  imgBase:      '',
  groceryList:  [],    // [{barcode, name, image}]
  loaded:       false,
  loading:      false,
};

// ── DOM ───────────────────────────────────────────────────────
const $         = id => document.getElementById(id);
const searchInput   = $('searchInput');
const searchResults = $('searchResults');
const groceryListEl = $('groceryList');
const listCountEl   = $('listCount');
const compareBtn    = $('compareBtn');
const resultsPH     = $('resultsPlaceholder');
const loadingState  = $('loadingState');
const loadingMsg    = $('loadingMsg');
const compResults   = $('comparisonResults');

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n) {
  const v = parseFloat(n);
  return isNaN(v) ? '—' : v.toFixed(2);
}
// Greek accent-insensitive normalize
function norm(s) {
  return (s||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[²³]/g,'')        // strip superscripts
    .replace(/\s+/g,' ').trim();
}
let toastTmr;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── localStorage ──────────────────────────────────────────────
function saveList() {
  try { localStorage.setItem(LS_LIST_KEY, JSON.stringify(state.groceryList)); }
  catch(e) {}
}
function loadListFromStorage() {
  try {
    const raw = localStorage.getItem(LS_LIST_KEY);
    if (raw) state.groceryList = JSON.parse(raw);
  } catch(e) { state.groceryList = []; }
}

// ── Load prices.json ──────────────────────────────────────────
async function loadData() {
  if (state.loaded || state.loading) return;
  state.loading = true;
  try {
    const r   = await fetch(PRICES_URL());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d   = await r.json();
    const res = d?.context?.MAPP_PRODUCTS?.result || {};

    // Build merchant lookup: uuid → display_name
    const merchantArr = Array.isArray(res.merchants) ? res.merchants : Object.values(res.merchants || {});
    merchantArr.forEach(m => {
      state.merchants[m.merchant_uuid] = m.display_name || m.name;
    });

    state.imgBase = res.img_base_url || '';

    // Build product list with normalized search field
    state.products = (res.products || []).map(p => ({
      barcode: p.barcode,
      name:    p.name,
      image:   p.image
        ? (state.imgBase ? state.imgBase + p.image : p.image)
        : '',
      prices:  p.prices || [],
      _norm:   norm(p.name),
    }));

    state.loaded  = true;

    // Update header status
    const statusEl = document.getElementById('catalogStatus');
    if (statusEl) statusEl.textContent = state.products.length.toLocaleString('el') + ' προϊόντα';
  } catch(e) {
    console.error('Data load error:', e);
    toast('⚠️ Αδυναμία φόρτωσης δεδομένων — δοκιμάστε ξανά');
  } finally {
    state.loading = false;
  }
}

// ── Search ────────────────────────────────────────────────────
let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) { closeSearch(); return; }
  searchDebounce = setTimeout(() => runSearch(q), 220);
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

  if (!state.loaded) {
    searchResults.innerHTML = `<div class="search-loading"><span class="spin-sm"></span> Φόρτωση καταλόγου…</div>`;
    await loadData();
    if (!state.loaded) { searchResults.innerHTML = `<div class="search-empty">Αποτυχία σύνδεσης. Ανανεώστε τη σελίδα.</div>`; return; }
  }

  const nq = norm(q);

  // Score: starts-with-word > contains
  const scored = [];
  for (const p of state.products) {
    const n = p._norm;
    if (!n.includes(nq)) continue;
    const score = n.startsWith(nq) ? 2 : n.split(/\s+/).some(w => w.startsWith(nq)) ? 1 : 0;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  const matches = scored.slice(0, 20).map(s => s.p);

  if (!matches.length) {
    searchResults.innerHTML = `<div class="search-empty">Δεν βρέθηκαν αποτελέσματα για «${esc(q)}»</div>`;
    return;
  }

  const inList = new Set(state.groceryList.map(i => i.barcode));
  searchResults.innerHTML = matches.map(p => {
    const already = inList.has(p.barcode);
    const imgSrc  = p.image;
    return `<div class="sr-item${already ? ' sr-added' : ''}"
                 data-barcode="${esc(p.barcode)}"
                 data-name="${esc(p.name)}"
                 data-image="${esc(imgSrc)}"
                 role="option">
      ${imgSrc
        ? `<img src="${esc(imgSrc)}" class="sr-thumb" alt="" loading="lazy" onerror="this.style.display='none'"/>`
        : `<div class="sr-thumb sr-thumb-ph">📦</div>`}
      <div class="sr-info">
        <div class="sr-name">${esc(p.name)}</div>
        <div class="sr-bar">${esc(p.barcode)}</div>
      </div>
      <div class="sr-action">${already ? '✓' : '+'}</div>
    </div>`;
  }).join('');

  searchResults.querySelectorAll('.sr-item:not(.sr-added)').forEach(el => {
    el.addEventListener('click', () => addToList(el.dataset.barcode, el.dataset.name, el.dataset.image));
  });
}

// ── List management ───────────────────────────────────────────
function addToList(barcode, name, image) {
  if (state.groceryList.find(i => i.barcode === barcode)) {
    toast('Υπάρχει ήδη στη λίστα'); return;
  }
  state.groceryList.push({ barcode, name, image });
  saveList();
  closeSearch();
  searchInput.value = '';
  renderList();
  updateBtn();
  resetResults();
}

function removeFromList(barcode) {
  state.groceryList = state.groceryList.filter(i => i.barcode !== barcode);
  saveList();
  renderList();
  updateBtn();
  resetResults();
}

function renderList() {
  const n = state.groceryList.length;
  listCountEl.textContent = n === 0 ? '0 προϊόντα' : n === 1 ? '1 προϊόν' : n + ' προϊόντα';
  if (!n) {
    groceryListEl.innerHTML = `<li class="list-empty">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><rect x="8" y="12" width="24" height="20" rx="3" stroke="#c5c5c5" stroke-width="1.5"/><path d="M14 12V9a6 6 0 0 1 12 0v3" stroke="#c5c5c5" stroke-width="1.5" stroke-linecap="round"/><path d="M14 20h12M14 26h8" stroke="#c5c5c5" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>Η λίστα σας αποθηκεύεται αυτόματα</p></li>`;
    return;
  }
  groceryListEl.innerHTML = state.groceryList.map(item => `
    <li class="grocery-item">
      ${item.image
        ? `<img src="${esc(item.image)}" class="item-thumb" alt="" onerror="this.style.display='none'"/>`
        : `<div class="item-thumb-ph">📦</div>`}
      <div class="item-info">
        <div class="item-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="item-bar">${esc(item.barcode)}</div>
      </div>
      <button class="item-rm" data-barcode="${esc(item.barcode)}" aria-label="Αφαίρεση">✕</button>
    </li>`).join('');
  groceryListEl.querySelectorAll('.item-rm').forEach(btn => {
    btn.addEventListener('click', () => removeFromList(btn.dataset.barcode));
  });
}

function updateBtn() {
  compareBtn.disabled = state.groceryList.length === 0;
}

// ── Comparison ────────────────────────────────────────────────
compareBtn.addEventListener('click', runComparison);

async function runComparison() {
  if (!state.groceryList.length) return;

  compareBtn.disabled = true;
  compareBtn.innerHTML = `<span class="spin-sm"></span> Φόρτωση δεδομένων…`;
  resultsPH.style.display = 'none';
  compResults.style.display = 'none';
  loadingState.style.display = 'flex';
  loadingMsg.textContent = 'Ανάκτηση τιμών από e-katanalotis…';

  if (!state.loaded) await loadData();

  loadingState.style.display = 'none';
  compareBtn.disabled = false;
  compareBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Σύγκριση τιμών`;

  renderResults();
}

// ── Render results ────────────────────────────────────────────
function renderResults() {
  if (!state.loaded) { toast('Δεν φορτώθηκαν δεδομένα'); return; }

  // Match each list item to catalog product
  const matched = state.groceryList.map(item => {
    const prod = state.products.find(p => p.barcode === item.barcode);
    return { item, prod };
  });

  // Collect all merchants that appear in any matched product
  const merchantSet = new Set();
  matched.forEach(({ prod }) => {
    if (prod) prod.prices.forEach(p => merchantSet.add(p.merchant_uuid));
  });

  // Sort merchants by display name
  const merchantIds = [...merchantSet].sort((a, b) => {
    const na = state.merchants[a] || String(a);
    const nb = state.merchants[b] || String(b);
    return na.localeCompare(nb, 'el');
  });

  if (!merchantIds.length) {
    compResults.innerHTML = `<div class="warn-banner">⚠️ Δεν βρέθηκαν τιμές για τα επιλεγμένα προϊόντα. Βεβαιωθείτε ότι τα προϊόντα υπάρχουν στον κατάλογο.</div>`;
    compResults.style.display = 'block';
    resultsPH.style.display = 'none';
    return;
  }

  // Build price matrix: item × merchant
  // priceMatrix[itemIdx][merchantId] = price | null
  const priceMatrix = matched.map(({ prod }) => {
    const row = {};
    if (prod) {
      prod.prices.forEach(p => { row[p.merchant_uuid] = p.price; });
    }
    return row;
  });

  // Compute per-merchant totals (only products that have a price for that merchant)
  const merchantTotals  = {}; // {mid: {total, count}}
  const merchantPresent = {}; // {mid: count of products with price}
  merchantIds.forEach(mid => { merchantTotals[mid] = { total: 0, count: 0 }; });
  matched.forEach((_, rowIdx) => {
    merchantIds.forEach(mid => {
      const p = priceMatrix[rowIdx][mid];
      if (p != null) {
        merchantTotals[mid].total += p;
        merchantTotals[mid].count += 1;
      }
    });
  });

  // Sort merchants by total (ascending)
  const sortedMerchants = [...merchantIds].sort((a, b) => merchantTotals[a].total - merchantTotals[b].total);
  const bestMid  = sortedMerchants[0];
  const worstMid = sortedMerchants[sortedMerchants.length - 1];

  const mName = mid => state.merchants[mid] || 'Store ' + mid;

  // ── Store summary cards ───────────────────────────────────
  let html = `<div class="section-title">Σύνολο καλαθιού ανά αλυσίδα</div><div class="store-cards">`;
  sortedMerchants.forEach((mid, idx) => {
    const info   = merchantTotals[mid];
    const isBest = mid === bestMid;
    const saving = info.total > 0 ? merchantTotals[worstMid].total - info.total : 0;
    html += `<div class="store-card${isBest ? ' best' : ''}">
      ${isBest ? `<div class="store-rank">🏆 Φθηνότερο</div>` : `<div class="store-rank-n">#${idx+1}</div>`}
      <div class="sc-name">${esc(mName(mid))}</div>
      <div class="sc-total">${info.total > 0 ? '€'+fmt(info.total) : '—'}</div>
      <div class="sc-avail">${info.count}/${state.groceryList.length} προϊόντα</div>
      ${isBest && saving > 0.01 ? `<div class="sc-save">εξοικ. €${fmt(saving)}</div>` : ''}
    </div>`;
  });
  html += `</div>`;

  // ── Optimal box ───────────────────────────────────────────
  const bestTotal  = merchantTotals[bestMid].total;
  const worstTotal = merchantTotals[worstMid].total;
  const saving     = worstTotal - bestTotal;
  html += `<div class="optimal-box">
    <div class="opt-title">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1l1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      Optimal solution
    </div>
    <div class="opt-row">
      <span>Αγοράστε όλα από <strong>${esc(mName(bestMid))}</strong></span>
      <span class="opt-val">€${fmt(bestTotal)}</span>
    </div>
    ${saving > 0.01 ? `<div class="opt-row">
      <span>Εξοικονόμηση έναντι ακριβότερου (${esc(mName(worstMid))})</span>
      <span class="opt-save">−€${fmt(saving)}</span>
    </div>` : ''}
    <div class="opt-row">
      <span>Τιμές ημερομηνίας</span>
      <span>${new Date().toLocaleDateString('el-GR')}</span>
    </div>
  </div>`;

  // ── Price matrix table ─────────────────────────────────────
  html += `<div class="section-title" style="margin-top:1.5rem">Αναλυτικός πίνακας τιμών</div>
  <div class="matrix-wrap"><table class="matrix">
    <thead><tr>
      <th class="col-product">Προϊόν</th>
      ${sortedMerchants.map(mid => `<th class="col-store${mid===bestMid?' col-best':''}">${esc(mName(mid))}</th>`).join('')}
    </tr></thead>
    <tbody>`;

  matched.forEach(({ item, prod }, rowIdx) => {
    const row = priceMatrix[rowIdx];
    // Find min price for this product across all merchants
    let minP = Infinity;
    sortedMerchants.forEach(mid => { const p = row[mid]; if (p != null && p < minP) minP = p; });

    html += `<tr>
      <td class="cell-product">
        ${item.image ? `<img src="${esc(item.image)}" class="cell-thumb" alt="" onerror="this.style.display='none'"/>` : ''}
        <span class="cell-pname" title="${esc(item.name)}">${esc(item.name)}</span>
      </td>`;

    sortedMerchants.forEach(mid => {
      const p    = row[mid];
      const ok   = p != null;
      const best = ok && Math.abs(p - minP) < 0.001;
      html += `<td class="cell-price${best?' price-best':''}${!ok?' price-na':''}">${ok ? '€'+fmt(p) : '—'}</td>`;
    });

    html += `</tr>`;
  });

  // ── Totals row ────────────────────────────────────────────
  html += `<tr class="totals-row">
    <td class="cell-product"><strong>Σύνολο καλαθιού</strong></td>
    ${sortedMerchants.map(mid => {
      const t      = merchantTotals[mid].total;
      const isBest = mid === bestMid;
      return `<td class="cell-price cell-total${isBest?' price-best':''}">${t>0?'€'+fmt(t):'—'}</td>`;
    }).join('')}
  </tr>`;

  html += `</tbody></table></div>`;

  // ── Data notice ───────────────────────────────────────────
  html += `<div class="data-notice">Δεδομένα: <a href="https://e-katanalotis.gov.gr" target="_blank" rel="noopener">e-katanalotis.gov.gr</a> · Ενημερώνονται κάθε 12 ώρες</div>`;

  compResults.innerHTML = html;
  compResults.style.display = 'block';
  resultsPH.style.display   = 'none';
}

function resetResults() {
  compResults.style.display = 'none';
  resultsPH.style.display   = 'flex';
}

// ── Init ──────────────────────────────────────────────────────
loadListFromStorage();
renderList();
updateBtn();
loadData(); // pre-load in background
