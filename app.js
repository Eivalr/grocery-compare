/* ─────────────────────────────────────────────────────────────
   Grosharee v8 — Greek Supermarket Price Comparator
   Data: warply.s3.amazonaws.com (e-katanalotis.gov.gr)
   ───────────────────────────────────────────────────────────── */

const CID_INTERVAL = 432e5;
const PRICES_URL   = () => {
  const cid = CID_INTERVAL * Math.floor(Date.now() / CID_INTERVAL);
  return `https://warply.s3.amazonaws.com/applications/ed840ad545884deeb6c6b699176797ed/basket-retailers/prices.json?cid=${cid}`;
};
const LS_KEY = 'grosharee_v1';

// ── State ─────────────────────────────────────────────────────
const state = {
  products:    [],   // { barcode, name, image, prices:[{merchant_uuid,price}], _norm }
  merchants:   {},   // { uuid → displayName }
  imgBase:     '',
  groceryList: [],   // { barcode, name, image }
  loaded:      false,
  loading:     false,
  searchOpen:  false,
};

// ── DOM ───────────────────────────────────────────────────────
const $          = id => document.getElementById(id);
const searchInput   = $('searchInput');
const searchInline  = $('searchInline');   // inline results area
const groceryListEl = $('groceryList');
const listCountEl   = $('listCount');
const compareBtn    = $('compareBtn');
const resultsPH     = $('resultsPlaceholder');
const loadingState  = $('loadingState');
const loadingMsg    = $('loadingMsg');
const compResults   = $('comparisonResults');

// ── Helpers ───────────────────────────────────────────────────
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmt = n => { const v = parseFloat(n); return isNaN(v) ? '—' : v.toFixed(2); };
const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[²³¹]/g,'').replace(/\s+/g,' ').trim();

let toastTmr;
const toast = msg => {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => el.classList.remove('show'), 2800);
};

// ── Storage ───────────────────────────────────────────────────
const saveList = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state.groceryList)); } catch(e) {} };
const loadList = () => { try { const r = localStorage.getItem(LS_KEY); if (r) state.groceryList = JSON.parse(r); } catch(e) { state.groceryList = []; } };

// ── Load catalog ──────────────────────────────────────────────
async function loadData() {
  if (state.loaded || state.loading) return;
  state.loading = true;
  try {
    const r = await fetch(PRICES_URL());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d   = await r.json();
    const res = d?.context?.MAPP_PRODUCTS?.result || {};

    const merchantArr = Array.isArray(res.merchants) ? res.merchants : Object.values(res.merchants || {});
    merchantArr.forEach(m => { state.merchants[m.merchant_uuid] = m.display_name || m.name; });

    state.imgBase  = res.img_base_url || '';
    state.products = (res.products || []).map(p => ({
      barcode: p.barcode,
      name:    p.name,
      image:   p.image ? state.imgBase + p.image : '',
      prices:  p.prices || [],
      _norm:   norm(p.name),
    }));
    state.loaded = true;

    const el = $('catalogStatus');
    if (el) el.textContent = state.products.length.toLocaleString('el') + ' προϊόντα';
  } catch(e) {
    console.error(e);
    toast('⚠️ Αδυναμία φόρτωσης δεδομένων');
  } finally {
    state.loading = false;
  }
}

// ── Search — inline (no absolute popup) ───────────────────────
let searchDebounce;

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = searchInput.value.trim();
  if (q.length < 2) { closeSearch(); return; }
  searchDebounce = setTimeout(() => runSearch(q), 220);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { clearTimeout(searchDebounce); runSearch(searchInput.value.trim()); }
  if (e.key === 'Escape') closeSearch();
});

$('searchBtn').addEventListener('click', () => {
  const q = searchInput.value.trim();
  if (q.length >= 2) runSearch(q); else searchInput.focus();
});

function closeSearch() {
  searchInline.innerHTML = '';
  searchInline.classList.remove('open');
  state.searchOpen = false;
}

async function runSearch(q) {
  if (q.length < 2) return;

  if (!state.loaded) {
    searchInline.classList.add('open');
    searchInline.innerHTML = `<div class="sr-msg"><span class="spin-sm"></span> Φόρτωση καταλόγου (${(2904).toLocaleString('el')} προϊόντα)…</div>`;
    await loadData();
    if (!state.loaded) { searchInline.innerHTML = `<div class="sr-msg">Αποτυχία σύνδεσης — ανανεώστε τη σελίδα.</div>`; return; }
  }

  const nq = norm(q);
  const scored = [];
  for (const p of state.products) {
    if (!p._norm.includes(nq)) continue;
    const score = p._norm.startsWith(nq) ? 2 : p._norm.split(/\s+/).some(w => w.startsWith(nq)) ? 1 : 0;
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'el'));
  const matches = scored.slice(0, 20).map(s => s.p);

  searchInline.classList.add('open');

  if (!matches.length) {
    searchInline.innerHTML = `<div class="sr-msg sr-empty">Δεν βρέθηκαν αποτελέσματα για «${esc(q)}»</div>`;
    return;
  }

  const inList = new Set(state.groceryList.map(i => i.barcode));

  searchInline.innerHTML = `
    <div class="sr-header">
      <span>${matches.length} αποτελέσματα</span>
      <button class="sr-close" id="srClose">✕ Κλείσιμο</button>
    </div>
    <div class="sr-grid">
      ${matches.map(p => {
        const already = inList.has(p.barcode);
        return `<div class="sr-card${already ? ' sr-card-added' : ''}"
                     data-barcode="${esc(p.barcode)}"
                     data-name="${esc(p.name)}"
                     data-image="${esc(p.image)}">
          <div class="sr-card-img">
            ${p.image
              ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='📦'"/>`
              : '📦'}
          </div>
          <div class="sr-card-body">
            <div class="sr-card-name">${esc(p.name)}</div>
            <div class="sr-card-bar">${esc(p.barcode)}</div>
          </div>
          <button class="sr-card-btn" ${already ? 'disabled' : ''} aria-label="${already ? 'Ήδη στη λίστα' : 'Προσθήκη'}">
            ${already ? '✓' : '+'}
          </button>
        </div>`;
      }).join('')}
    </div>`;

  $('srClose')?.addEventListener('click', closeSearch);

  searchInline.querySelectorAll('.sr-card:not(.sr-card-added) .sr-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.sr-card');
      addToList(card.dataset.barcode, card.dataset.name, card.dataset.image);
    });
  });

  state.searchOpen = true;
}

// ── List management ───────────────────────────────────────────
function addToList(barcode, name, image) {
  if (state.groceryList.find(i => i.barcode === barcode)) { toast('Υπάρχει ήδη στη λίστα'); return; }
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
      <svg width="36" height="36" viewBox="0 0 40 40" fill="none"><rect x="8" y="12" width="24" height="20" rx="3" stroke="#d1d5db" stroke-width="1.5"/><path d="M14 12V9a6 6 0 0 1 12 0v3" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"/><path d="M14 20h12M14 26h8" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>Η λίστα αποθηκεύεται αυτόματα</p></li>`;
    return;
  }
  groceryListEl.innerHTML = state.groceryList.map(item => `
    <li class="grocery-item">
      ${item.image ? `<img src="${esc(item.image)}" class="item-thumb" alt="" onerror="this.style.display='none'"/>` : `<div class="item-thumb-ph">📦</div>`}
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

const updateBtn = () => { compareBtn.disabled = state.groceryList.length === 0; };

// ── Comparison ────────────────────────────────────────────────
compareBtn.addEventListener('click', runComparison);

async function runComparison() {
  if (!state.groceryList.length) return;
  compareBtn.disabled = true;
  compareBtn.innerHTML = `<span class="spin-sm"></span> Φόρτωση…`;
  resultsPH.style.display   = 'none';
  compResults.style.display  = 'none';
  loadingState.style.display = 'flex';
  loadingMsg.textContent     = 'Ανάκτηση τιμών από e-katanalotis…';

  if (!state.loaded) await loadData();

  loadingState.style.display = 'none';
  compareBtn.disabled = false;
  compareBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12l4-4 3 3 5-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Σύγκριση τιμών`;

  renderResults();
}

// ── Render results ────────────────────────────────────────────
function renderResults() {
  const total = state.groceryList.length;

  // Match list items to catalog
  const matched = state.groceryList.map(item => {
    const prod = state.products.find(p => p.barcode === item.barcode);
    return { item, prod };
  });

  // Collect all store IDs
  const storeSet = new Set();
  matched.forEach(({ prod }) => {
    if (prod) prod.prices.forEach(p => storeSet.add(p.merchant_uuid));
  });

  const storeIds = [...storeSet];
  if (!storeIds.length) {
    compResults.innerHTML = `<div class="warn-banner">⚠️ Δεν βρέθηκαν τιμές για τα επιλεγμένα προϊόντα.</div>`;
    compResults.style.display = 'block';
    resultsPH.style.display   = 'none';
    return;
  }

  // Build price matrix: matched[i] × storeId → price|null
  const matrix = matched.map(({ prod }) => {
    const row = {};
    if (prod) prod.prices.forEach(p => { row[p.merchant_uuid] = parseFloat(p.price) || null; });
    return row;
  });

  // Compute per-store totals AND coverage
  const storeTotals = {};
  storeIds.forEach(sid => { storeTotals[sid] = { total: 0, count: 0 }; });
  matched.forEach((_, ri) => {
    storeIds.forEach(sid => {
      const p = matrix[ri][sid];
      if (p > 0) { storeTotals[sid].total += p; storeTotals[sid].count++; }
    });
  });

  // Sort by: full-coverage first, then by total ascending
  const sorted = [...storeIds].sort((a, b) => {
    const ca = storeTotals[a].count, cb = storeTotals[b].count;
    if (ca !== cb) return cb - ca;                       // more coverage first
    return storeTotals[a].total - storeTotals[b].total;  // then cheaper
  });

  const mName = sid => state.merchants[sid] || 'Store ' + sid;

  // ── Store summary cards ─────────────────────────────────────
  // Full-coverage stores → proper comparison
  // Partial stores → shown separately with warning
  const fullStores    = sorted.filter(s => storeTotals[s].count === total);
  const partialStores = sorted.filter(s => storeTotals[s].count < total);

  // Best = cheapest among FULL stores (or cheapest partial if no full)
  const bestSid  = fullStores.length ? fullStores[0] : sorted[0];
  const worstSid = fullStores.length ? fullStores[fullStores.length - 1] : sorted[sorted.length - 1];
  const saving   = storeTotals[worstSid].total - storeTotals[bestSid].total;

  let html = '';

  // Full-coverage store cards
  if (fullStores.length) {
    html += `<div class="section-title">Σύνολο καλαθιού (πλήρης κάλυψη)</div><div class="store-cards">`;
    fullStores.forEach((sid, idx) => {
      const info   = storeTotals[sid];
      const isBest = idx === 0;
      html += `<div class="store-card${isBest ? ' best' : ''}">
        ${isBest ? `<div class="store-rank">🏆 Φθηνότερο</div>` : `<div class="store-rank-n">#${idx+1}</div>`}
        <div class="sc-name">${esc(mName(sid))}</div>
        <div class="sc-total">€${fmt(info.total)}</div>
        <div class="sc-avail sc-full">${info.count}/${total} ✓</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Partial-coverage store cards (separate section, lower visual weight)
  if (partialStores.length) {
    html += `<div class="section-title partial-title">Μερική κάλυψη (δεν συγκρίνονται)</div><div class="store-cards store-cards-partial">`;
    partialStores.forEach(sid => {
      const info = storeTotals[sid];
      html += `<div class="store-card store-card-partial">
        <div class="store-rank-n">${info.count}/${total} προϊ.</div>
        <div class="sc-name">${esc(mName(sid))}</div>
        <div class="sc-total sc-partial">€${fmt(info.total)}</div>
        <div class="sc-avail sc-warn">⚠️ ελλιπές</div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── Optimal box ─────────────────────────────────────────────
  if (fullStores.length) {
    html += `<div class="optimal-box">
      <div class="opt-title">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M7.5 1l1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        Optimal solution
      </div>
      <div class="opt-row">
        <span>Αγοράστε όλα από <strong>${esc(mName(bestSid))}</strong></span>
        <span class="opt-val">€${fmt(storeTotals[bestSid].total)}</span>
      </div>
      ${saving > 0.01 ? `<div class="opt-row">
        <span>Εξοικονόμηση έναντι ακριβότερου (${esc(mName(worstSid))})</span>
        <span class="opt-save">−€${fmt(saving)}</span>
      </div>` : ''}
      <div class="opt-row">
        <span>Βάση σύγκρισης</span>
        <span>${fullStores.length} αλυσίδες με πλήρη κάλυψη ${total}/${total} προϊόντων</span>
      </div>
    </div>`;
  } else {
    html += `<div class="warn-banner">⚠️ Καμία αλυσίδα δεν έχει όλα τα επιλεγμένα προϊόντα. Το optimal solution υπολογίζεται μόνο για αλυσίδες με πλήρη κάλυψη.</div>`;
  }

  // ── Price matrix table ───────────────────────────────────────
  // All stores as columns, sorted (full first)
  const tableCols = [...fullStores, ...partialStores];

  html += `<div class="section-title" style="margin-top:1.5rem">Αναλυτικός πίνακας τιμών</div>
  <div class="matrix-wrap"><table class="matrix">
    <thead><tr>
      <th class="col-product">Προϊόν</th>
      ${tableCols.map(sid => {
        const isFull = storeTotals[sid].count === total;
        return `<th class="col-store${sid===bestSid?' col-best':''}${!isFull?' col-partial':''}">
          ${esc(mName(sid))}
          ${!isFull ? `<span class="col-partial-badge">${storeTotals[sid].count}/${total}</span>` : ''}
        </th>`;
      }).join('')}
    </tr></thead>
    <tbody>`;

  matched.forEach(({ item }, ri) => {
    const row = matrix[ri];
    let minP  = Infinity;
    tableCols.forEach(sid => { const p = row[sid]; if (p > 0 && p < minP) minP = p; });

    html += `<tr>
      <td class="cell-product">
        ${item.image ? `<img src="${esc(item.image)}" class="cell-thumb" alt="" onerror="this.style.display='none'"/>` : ''}
        <span class="cell-pname" title="${esc(item.name)}">${esc(item.name)}</span>
      </td>`;
    tableCols.forEach(sid => {
      const p    = row[sid];
      const ok   = p > 0;
      const best = ok && Math.abs(p - minP) < 0.001;
      html += `<td class="cell-price${best?' price-best':''}${!ok?' price-na':''}">${ok?'€'+fmt(p):'—'}</td>`;
    });
    html += `</tr>`;
  });

  // Totals row
  html += `<tr class="totals-row">
    <td class="cell-product"><strong>Σύνολο</strong></td>
    ${tableCols.map(sid => {
      const t      = storeTotals[sid].total;
      const isBest = sid === bestSid && fullStores.length > 0;
      const isFull = storeTotals[sid].count === total;
      return `<td class="cell-price cell-total${isBest?' price-best':''}${!isFull?' cell-partial-total':''}">
        €${fmt(t)}${!isFull?`<span class="total-warn" title="${storeTotals[sid].count}/${total} προϊόντα"> ⚠️</span>`:''}
      </td>`;
    }).join('')}
  </tr>`;

  html += `</tbody></table></div>`;
  html += `<div class="data-notice">Δεδομένα: <a href="https://e-katanalotis.gov.gr" target="_blank" rel="noopener">e-katanalotis.gov.gr</a> · Ενημέρωση κάθε 12ώρες · ${new Date().toLocaleDateString('el-GR')}</div>`;
  html += `<div class="export-row">
    <button class="btn-export" id="exportPdfBtn" onclick="exportPDF()">
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M3 1h6l3 3v10H3V1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 1v3h3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 7h5M5 9.5h5M5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      Αποθήκευση ως PDF
    </button>
  </div>`;

  compResults.innerHTML  = html;
  compResults.style.display = 'block';
  resultsPH.style.display   = 'none';
}

function resetResults() {
  compResults.style.display = 'none';
  resultsPH.style.display   = 'flex';
}

// ── Export PDF ───────────────────────────────────────────────
function exportPDF() {
  // Set print title with date
  const date = new Date().toLocaleDateString('el-GR');
  const count = state.groceryList.length;
  document.title = `Grosharee — Σύγκριση τιμών ${date}`;
  // Small delay so title updates before print dialog
  setTimeout(() => {
    window.print();
    // Restore title
    setTimeout(() => { document.title = 'Grosharee — Σύγκριση τιμών supermarket'; }, 1000);
  }, 100);
}

// ── Init ──────────────────────────────────────────────────────
loadList();
renderList();
updateBtn();
loadData();
