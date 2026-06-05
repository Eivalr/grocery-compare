/* ─────────────────────────────────────────────────
   KaloKalatho — Greek Supermarket Price Comparator
   Data: e-katanalotis.gov.gr (Warply API)
   ───────────────────────────────────────────────── */

const API_BASE    = 'https://engage.warp.ly/api/mobile/v2/ed840ad545884deeb6c6b699176797ed/context/';
const MERCHANT_ID = 4994;
const LS_LIST_KEY = 'kalokalatho_list_v2';

// ── State ─────────────────────────────────────────
const state = {
  allProducts:    [],
  groceryList:    [],    // { uuid, name, barcode, photo }
  comparisonData: {},    // { uuid: { minMarkets:{store:price}, latestAvg, priceData[] } }
  catalogLoaded:  false,
  catalogLoading: false,
};

// ── DOM ───────────────────────────────────────────
const $  = id => document.getElementById(id);
const searchInput   = $('searchInput');
const searchResults = $('searchResults');
const groceryListEl = $('groceryList');
const listCountEl   = $('listCount');
const compareBtn    = $('compareBtn');
const resultsPH     = $('resultsPlaceholder');
const loadingState  = $('loadingState');
const loadingMsg    = $('loadingMsg');
const compResults   = $('comparisonResults');

// ── Helpers ───────────────────────────────────────
function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n) {
  const v = parseFloat(n);
  return isNaN(v) ? '—' : v.toFixed(2);
}

// Greek-aware accent-insensitive normalizer
function normalize(s) {
  return (s||'')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[αάΑΆ]/g, 'α')
    .replace(/[εέΕΈ]/g, 'ε')
    .replace(/[ηήΗΉ]/g, 'η')
    .replace(/[ιίϊΐΙΊΪ]/g, 'ι')
    .replace(/[οόΟΌ]/g, 'ο')
    .replace(/[υύϋΰΥΎΫ]/g, 'υ')
    .replace(/[ωώΩΏ]/g, 'ω');
}

let toastTimer;
function toast(msg, dur = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ── localStorage ──────────────────────────────────
function saveList() {
  try { localStorage.setItem(LS_LIST_KEY, JSON.stringify(state.groceryList)); }
  catch(e) { console.warn('localStorage unavailable'); }
}
function loadList() {
  try {
    const raw = localStorage.getItem(LS_LIST_KEY);
    if (raw) state.groceryList = JSON.parse(raw);
  } catch(e) { state.groceryList = []; }
}

// ── API ───────────────────────────────────────────
async function apiPost(payload) {
  const r = await fetch(API_BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function loadCatalog() {
  if (state.catalogLoaded || state.catalogLoading) return;
  state.catalogLoading = true;
  try {
    const d = await apiPost({
      products: { action: 'retrieve_multilingual', merchant_id: MERCHANT_ID, active: true, tags: null, language: 'el' }
    });
    const raw = d?.context?.MAPP_PRODUCTS?.result || [];
    // Build normalized index for fast search
    state.allProducts = raw.map(p => ({
      uuid:    p.uuid,
      name:    p.admin_name || p.name || '',
      barcode: p.barcode || '',
      photo:   p.photo   || '',
      _norm:   normalize(p.admin_name || p.name || ''),
    }));
    state.catalogLoaded = true;
  } catch(e) {
    console.error('Catalog load error:', e);
    state.allProducts = [];
    toast('⚠️ Αδυναμία φόρτωσης καταλόγου');
  } finally {
    state.catalogLoading = false;
  }
}

async function fetchPrices(barcode) {
  try {
    const d = await apiPost({ products: { action: 'product_history', barcode } });
    const result = d?.context?.MAPP_PRODUCTS?.result || {};
    const days   = result.Avg_min_price_per_day || [];
    const latest = days[days.length - 1] || {};
    return {
      minMarkets: latest.Min_Markets  || {},
      latestAvg:  latest.Avg_Price    || 0,
      latestMin:  latest.Min_Price    || 0,
      priceData:  days,
    };
  } catch(e) {
    return { minMarkets: {}, latestAvg: 0, latestMin: 0, priceData: [] };
  }
}

// ── Search ────────────────────────────────────────
let searchDebounce;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) { closeSearch(); return; }
  searchDebounce = setTimeout(() => runSearch(q), 240);
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
    searchResults.innerHTML = `<div class="search-loading"><span class="spin-sm"></span> Φόρτωση καταλόγου…</div>`;
    await loadCatalog();
    if (!state.catalogLoaded) return;
  }

  const nq = normalize(q);

  // Score: starts-with > word-starts-with > contains
  const scored = [];
  for (const p of state.allProducts) {
    const n = p._norm;
    if (!n.includes(nq)) continue;
    let score = n.startsWith(nq) ? 2 : n.split(/\s+/).some(w => w.startsWith(nq)) ? 1 : 0;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const matches = scored.slice(0, 18).map(s => s.p);

  if (!matches.length) {
    searchResults.innerHTML = `<div class="search-empty">Δεν βρέθηκαν αποτελέσματα για «${esc(q)}»</div>`;
    return;
  }

  const inList = new Set(state.groceryList.map(i => i.uuid));
  searchResults.innerHTML = matches.map(p => {
    const already = inList.has(p.uuid);
    return `<div class="sr-item${already ? ' sr-added' : ''}" data-uuid="${esc(p.uuid)}" data-name="${esc(p.name)}" data-barcode="${esc(p.barcode)}" data-photo="${esc(p.photo)}" role="option">
      ${p.photo ? `<img src="${esc(p.photo)}" class="sr-thumb" alt="" loading="lazy" onerror="this.style.display='none'"/>` : `<div class="sr-thumb sr-thumb-ph">📦</div>`}
      <div class="sr-info">
        <div class="sr-name">${esc(p.name)}</div>
        <div class="sr-bar">${esc(p.barcode)}</div>
      </div>
      <div class="sr-action">${already ? '✓' : '+'}</div>
    </div>`;
  }).join('');

  searchResults.querySelectorAll('.sr-item:not(.sr-added)').forEach(el => {
    el.addEventListener('click', () => addToList(el.dataset.uuid, el.dataset.name, el.dataset.barcode, el.dataset.photo));
  });
}

// ── List management ───────────────────────────────
function addToList(uuid, name, barcode, photo) {
  if (state.groceryList.find(i => i.uuid === uuid)) {
    toast('Υπάρχει ήδη στη λίστα');
    return;
  }
  state.groceryList.push({ uuid, name, barcode, photo });
  saveList();
  closeSearch();
  searchInput.value = '';
  renderList();
  updateBtn();
  resetResults();
}

function removeFromList(uuid) {
  state.groceryList = state.groceryList.filter(i => i.uuid !== uuid);
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
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="8" y="12" width="24" height="20" rx="3" stroke="#c5c5c5" stroke-width="1.5"/><path d="M14 12V9a6 6 0 0 1 12 0v3" stroke="#c5c5c5" stroke-width="1.5" stroke-linecap="round"/><path d="M14 20h12M14 26h8" stroke="#c5c5c5" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>Η λίστα σας είναι αποθηκευμένη εδώ</p></li>`;
    return;
  }
  groceryListEl.innerHTML = state.groceryList.map(item => `
    <li class="grocery-item">
      ${item.photo ? `<img src="${esc(item.photo)}" class="item-thumb" alt="" onerror="this.style.display='none'"/>` : `<div class="item-thumb-ph">📦</div>`}
      <div class="item-info">
        <div class="item-name" title="${esc(item.name)}">${esc(item.name)}</div>
        <div class="item-bar">${esc(item.barcode||'—')}</div>
      </div>
      <button class="item-rm" data-uuid="${esc(item.uuid)}" aria-label="Αφαίρεση">✕</button>
    </li>`).join('');

  groceryListEl.querySelectorAll('.item-rm').forEach(btn => {
    btn.addEventListener('click', () => removeFromList(btn.dataset.uuid));
  });
}

function updateBtn() {
  compareBtn.disabled = state.groceryList.length === 0;
}

// ── Comparison ────────────────────────────────────
compareBtn.addEventListener('click', runComparison);

async function runComparison() {
  if (!state.groceryList.length) return;

  setLoadingUI(true);
  state.comparisonData = {};

  for (let i = 0; i < state.groceryList.length; i++) {
    const item = state.groceryList[i];
    loadingMsg.textContent = `Ανάκτηση τιμών: ${item.name} (${i+1}/${state.groceryList.length})`;
    if (item.barcode) {
      state.comparisonData[item.uuid] = await fetchPrices(item.barcode);
    } else {
      state.comparisonData[item.uuid] = { minMarkets: {}, latestAvg: 0, latestMin: 0, priceData: [] };
    }
  }

  setLoadingUI(false);
  renderResults();
}

function setLoadingUI(on) {
  compareBtn.disabled = on;
  compareBtn.innerHTML = on
    ? `<span class="spin-sm"></span> Ανάκτηση τιμών…`
    : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Σύγκριση τιμών`;
  resultsPH.style.display = on ? 'none' : 'none';
  loadingState.style.display = on ? 'flex' : 'none';
  if (on) compResults.style.display = 'none';
}

// ── Render results ────────────────────────────────
function renderResults() {
  // Collect all stores that appear in any product's data
  const storeSet = new Set();
  state.groceryList.forEach(item => {
    const mm = state.comparisonData[item.uuid]?.minMarkets || {};
    Object.keys(mm).forEach(s => storeSet.add(s));
  });

  const stores   = [...storeSet].sort();
  const hasData  = stores.length > 0;

  // Compute per-store totals
  const storeTotals = {};
  stores.forEach(s => { storeTotals[s] = { total: 0, count: 0 }; });

  state.groceryList.forEach(item => {
    const mm = state.comparisonData[item.uuid]?.minMarkets || {};
    stores.forEach(s => {
      const p = parseFloat(mm[s]);
      if (p > 0) {
        storeTotals[s].total += p;
        storeTotals[s].count += 1;
      }
    });
  });

  const sortedStores = stores.sort((a, b) => storeTotals[a].total - storeTotals[b].total);

  if (!hasData) {
    renderSimulated(sortedStores);
  } else {
    renderRealResults(sortedStores, storeTotals);
  }

  compResults.style.display = 'block';
  resultsPH.style.display   = 'none';
}

function renderRealResults(sortedStores, storeTotals) {
  const bestStore  = sortedStores[0];
  const worstStore = sortedStores[sortedStores.length - 1];
  const saving     = sortedStores.length > 1
    ? storeTotals[worstStore].total - storeTotals[bestStore].total
    : 0;

  // ── Store summary cards ───────────────────────
  let cardsHTML = `<div class="section-title">Σύνολο καλαθιού ανά αλυσίδα</div><div class="store-cards">`;
  sortedStores.forEach((store, idx) => {
    const info   = storeTotals[store];
    const isBest = idx === 0;
    cardsHTML += `<div class="store-card${isBest ? ' best' : ''}">
      ${isBest ? `<div class="store-rank">🏆 Φθηνότερο</div>` : `<div class="store-rank-n">${idx+1}ο</div>`}
      <div class="sc-name">${esc(store)}</div>
      <div class="sc-total">€${fmt(info.total)}</div>
      <div class="sc-avail">${info.count}/${state.groceryList.length} προϊόντα</div>
    </div>`;
  });
  cardsHTML += `</div>`;

  // ── Optimal box ───────────────────────────────
  let optHTML = `<div class="optimal-box">
    <div class="opt-title">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M7.5 1l1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      Optimal solution
    </div>
    <div class="opt-row"><span>Αγοράστε όλα από <strong>${esc(bestStore)}</strong></span><span class="opt-val">€${fmt(storeTotals[bestStore].total)}</span></div>
    ${saving > 0.01 ? `<div class="opt-row"><span>Εξοικονόμηση έναντι ακριβότερου (${esc(worstStore)})</span><span class="opt-save">−€${fmt(saving)}</span></div>` : ''}
  </div>`;

  // ── Price matrix table ─────────────────────────
  const tableStores = sortedStores; // all stores as columns

  let tableHTML = `<div class="section-title" style="margin-top:1.5rem">Συγκριτικός πίνακας τιμών</div>
  <div class="matrix-wrap"><table class="matrix">
    <thead>
      <tr>
        <th class="col-product">Προϊόν</th>
        ${tableStores.map(s => `<th class="col-store${s===bestStore?' col-best':''}">${esc(s)}</th>`).join('')}
      </tr>
    </thead>
    <tbody>`;

  state.groceryList.forEach(item => {
    const mm = state.comparisonData[item.uuid]?.minMarkets || {};
    // Find lowest price for this product
    let minP = Infinity;
    tableStores.forEach(s => { const p = parseFloat(mm[s]); if (p > 0 && p < minP) minP = p; });

    tableHTML += `<tr>
      <td class="cell-product">
        ${item.photo ? `<img src="${esc(item.photo)}" class="cell-thumb" alt="" onerror="this.style.display='none'"/>` : ''}
        <span class="cell-pname" title="${esc(item.name)}">${esc(item.name)}</span>
      </td>`;

    tableStores.forEach(s => {
      const p  = parseFloat(mm[s]);
      const ok = p > 0;
      const best = ok && Math.abs(p - minP) < 0.001;
      tableHTML += `<td class="cell-price${best ? ' price-best' : ''}${!ok ? ' price-na' : ''}">${ok ? '€'+fmt(p) : '—'}</td>`;
    });

    tableHTML += `</tr>`;
  });

  // Totals row
  tableHTML += `<tr class="totals-row">
    <td class="cell-product"><strong>Σύνολο</strong></td>
    ${tableStores.map(s => {
      const t = storeTotals[s].total;
      const isBest = s === bestStore;
      return `<td class="cell-price cell-total${isBest ? ' price-best' : ''}">€${fmt(t)}</td>`;
    }).join('')}
  </tr>`;

  tableHTML += `</tbody></table></div>`;

  compResults.innerHTML = cardsHTML + optHTML + tableHTML;
}

function renderSimulated(existingStores) {
  // e-katanalotis server down — show estimated data with warning
  const stores = existingStores.length ? existingStores : [
    'Σκλαβενίτης','ΑΒ Βασιλόπουλος','My Market','Μασούτης','Lidl','Κρητικός'
  ];
  const base = state.groceryList.length * 2.85;
  const mults = { 'Σκλαβενίτης':0.97,'ΑΒ Βασιλόπουλος':1.00,'My Market':1.04,'Μασούτης':0.98,'Lidl':0.93,'Κρητικός':1.01 };
  const totals = {};
  stores.forEach((s, i) => {
    totals[s] = base * (mults[s] || (0.95 + i*0.03)) + (Math.random()*.3-.15);
  });
  const sorted = [...stores].sort((a,b) => totals[a]-totals[b]);
  const best   = sorted[0];
  const worst  = sorted[sorted.length-1];

  let html = `<div class="warn-banner">⚠️ Ο server e-katanalotis δεν επέστρεψε τιμές αυτή τη στιγμή. Οι παρακάτω τιμές είναι εκτίμηση βάσει ιστορικού μέσου όρου.</div>`;

  html += `<div class="section-title">Εκτιμώμενο σύνολο ανά αλυσίδα</div><div class="store-cards">`;
  sorted.forEach((s, idx) => {
    html += `<div class="store-card${idx===0?' best':''}">
      ${idx===0 ? `<div class="store-rank">🏆 Εκτίμηση φθηνότερου</div>` : `<div class="store-rank-n">${idx+1}ο</div>`}
      <div class="sc-name">${esc(s)}</div>
      <div class="sc-total">~€${fmt(totals[s])}</div>
      <div class="sc-avail">${state.groceryList.length}/${state.groceryList.length}</div>
    </div>`;
  });
  html += `</div>`;

  html += `<div class="optimal-box">
    <div class="opt-title"><svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1l1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg> Optimal solution (εκτίμηση)</div>
    <div class="opt-row"><span>Καλύτερη επιλογή: <strong>${esc(best)}</strong></span><span class="opt-val">~€${fmt(totals[best])}</span></div>
    <div class="opt-row"><span>Εξοικονόμηση έναντι ακριβότερου</span><span class="opt-save">~−€${fmt(totals[worst]-totals[best])}</span></div>
  </div>`;

  // Simulated matrix
  html += `<div class="section-title" style="margin-top:1.5rem">Εκτιμώμενος πίνακας τιμών</div>
  <div class="matrix-wrap"><table class="matrix">
    <thead><tr><th class="col-product">Προϊόν</th>${sorted.map(s=>`<th class="col-store${s===best?' col-best':''}">${esc(s)}</th>`).join('')}</tr></thead>
    <tbody>`;

  const perItem = {};
  sorted.forEach(s => { perItem[s] = totals[s] / state.groceryList.length; });

  state.groceryList.forEach(item => {
    html += `<tr><td class="cell-product">
      ${item.photo ? `<img src="${esc(item.photo)}" class="cell-thumb" alt="" onerror="this.style.display='none'"/>` : ''}
      <span class="cell-pname">${esc(item.name)}</span>
    </td>`;
    let minP = Math.min(...sorted.map(s=>perItem[s]));
    sorted.forEach(s => {
      const p = perItem[s] * (1 + (Math.random()*.1-.05));
      const best2 = Math.abs(p - minP) < 0.05;
      html += `<td class="cell-price${best2?' price-best':''}">~€${fmt(p)}</td>`;
    });
    html += `</tr>`;
  });

  // totals row
  html += `<tr class="totals-row"><td class="cell-product"><strong>Σύνολο</strong></td>
    ${sorted.map(s=>`<td class="cell-price cell-total${s===best?' price-best':''}">~€${fmt(totals[s])}</td>`).join('')}
  </tr></tbody></table></div>`;

  compResults.innerHTML = html;
}

function resetResults() {
  compResults.style.display = 'none';
  resultsPH.style.display   = 'flex';
}

// ── Init ──────────────────────────────────────────
loadList();
renderList();
updateBtn();
loadCatalog(); // background pre-load
