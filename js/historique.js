// C:\Me\AppMoney\MeParisPortifs\js\historique.js
// ═══════════════════════════════════════════════════════════════════
// v6.0.4 — Historique unifié (Saisies + Transactions)
//   • Onglet "Saisies" : paris sportifs avec filtres avancés
//   • Onglet "Transactions" : historique financier complet
//   • Pagination serveur, exports PDF/CSV (saisies uniquement)
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  /* ═══════════════════════════════════════════════════════════════ */
  /* ÉTAT                                                          */
  /* ═══════════════════════════════════════════════════════════════ */
  const state = {
    activeTab: 'saisies',
    raw: [],
    page: 1,
    perPage: 30,
    total: 0,
    hasMore: false,
    loading: false,
    filters: {
      search: '', dateFrom: '', dateTo: '', statut: '',
      tableau: '', typeResult: '', sort: 'date_desc'
    }
  };

  /* ═══════════════════════════════════════════════════════════════ */
  /* HELPERS                                                       */
  /* ═══════════════════════════════════════════════════════════════ */
  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
  const esc = (s) => (window.APP && window.APP._esc) ? window.APP._esc(s) : String(s ?? '');
  const lblCol = (c) => c === '1' ? 'W1' : c === 'N' ? 'X' : c === '2' ? 'W2' : '—';
  const isAdmin = () => window.CURRENT_USER && window.CURRENT_USER.role === 'admin';

  /* ═══════════════════════════════════════════════════════════════ */
  /* TAB SAISIES — Chargement serveur                              */
  /* ═══════════════════════════════════════════════════════════════ */
  async function loadPage() {
    const { dateFrom, dateTo } = state.filters;
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo)   params.set('to', dateTo);
    params.set('limit', state.perPage);
    params.set('offset', (state.page - 1) * state.perPage);

    try {
      state.loading = true;
      const r = await API.get(`/historique?${params.toString()}`);
      state.raw = r.entries || [];
      state.total = r.total || 0;
      state.hasMore = r.hasMore || false;
    } catch (e) {
      state.raw = [];
      state.total = 0;
      state.hasMore = false;
    } finally {
      state.loading = false;
    }
  }

  function applyClientFilters() {
    const f = state.filters;
    let list = [...state.raw];

    if (f.search) {
      const q = f.search.toLowerCase().trim();
      list = list.filter(e => `${e.equipe1} ${e.equipe2}`.toLowerCase().includes(q));
    }
    if (f.statut === 'gagne')   list = list.filter(e => e.statut && e.Ri !== null && e.Ri >= 0);
    if (f.statut === 'perdu')   list = list.filter(e => e.statut && e.Ri !== null && e.Ri < 0);
    if (f.statut === 'attente') list = list.filter(e => !e.statut);
    if (f.tableau) list = list.filter(e => String(e.tableauChoisi) === f.tableau);
    if (f.typeResult) list = list.filter(e => e.statut === f.typeResult);

    switch (f.sort) {
      case 'date_asc':  list.sort((a, b) => a.date.localeCompare(b.date) || a.idx - b.idx); break;
      case 'gain_desc': list.sort((a, b) => (b.Ri || 0) - (a.Ri || 0)); break;
      case 'gain_asc':  list.sort((a, b) => (a.Ri || 0) - (b.Ri || 0)); break;
      default:          list.sort((a, b) => b.date.localeCompare(a.date) || a.idx - b.idx);
    }
    return list;
  }

  function computeStats(list) {
    let totalMises = 0, totalGains = 0, gagnes = 0, perdus = 0, attente = 0;
    list.forEach(e => {
      if (!e.valide) return;
      totalMises += e.mise;
      if (e.statut) {
        totalGains += e.gain;
        if (e.Ri !== null && e.Ri >= 0) gagnes++; else perdus++;
      } else attente++;
    });
    const total = gagnes + perdus;
    return {
      nb: list.length, totalMises, totalGains,
      Ri: totalGains - totalMises,
      gagnes, perdus, attente,
      taux: total > 0 ? (gagnes / total) * 100 : 0
    };
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* RENDU FILTRES SAISIES                                         */
  /* ═══════════════════════════════════════════════════════════════ */
  function renderFilters() {
    const f = state.filters;
    return `
      <div class="hist-filters glass">
        <div class="hist-filter-row">
          <input type="text" class="input" id="hist-search"
                 placeholder="🔍 Rechercher une équipe…" value="${esc(f.search)}">
          <input type="date" class="input" id="hist-from" value="${f.dateFrom}">
          <input type="date" class="input" id="hist-to" value="${f.dateTo}">
        </div>
        <div class="hist-filter-row">
          <select class="input" id="hist-statut">
            <option value="">📊 Tous statuts</option>
            <option value="gagne" ${f.statut === 'gagne' ? 'selected' : ''}>✅ Gagnés</option>
            <option value="perdu" ${f.statut === 'perdu' ? 'selected' : ''}>❌ Perdus</option>
            <option value="attente" ${f.statut === 'attente' ? 'selected' : ''}>⏳ En attente</option>
          </select>
          <select class="input" id="hist-tableau">
            <option value="">🔀 Tous tableaux</option>
            <option value="1" ${f.tableau === '1' ? 'selected' : ''}>T1</option>
            <option value="2" ${f.tableau === '2' ? 'selected' : ''}>T2</option>
            <option value="3" ${f.tableau === '3' ? 'selected' : ''}>T3</option>
          </select>
          <select class="input" id="hist-type">
            <option value="">💱 Tous résultats</option>
            <option value="1" ${f.typeResult === '1' ? 'selected' : ''}>W1</option>
            <option value="N" ${f.typeResult === 'N' ? 'selected' : ''}>X</option>
            <option value="2" ${f.typeResult === '2' ? 'selected' : ''}>W2</option>
          </select>
          <select class="input" id="hist-sort">
            <option value="date_desc" ${f.sort === 'date_desc' ? 'selected' : ''}>Date ↓</option>
            <option value="date_asc"  ${f.sort === 'date_asc'  ? 'selected' : ''}>Date ↑</option>
            <option value="gain_desc" ${f.sort === 'gain_desc' ? 'selected' : ''}>Gain ↓</option>
            <option value="gain_asc"  ${f.sort === 'gain_asc'  ? 'selected' : ''}>Gain ↑</option>
          </select>
        </div>
        <div class="hist-filter-row right">
          <span class="hist-counter" id="hist-counter">—</span>
          <button class="btn ghost sm" id="hist-reset">🔄 Réinitialiser</button>
          <button class="btn sm" id="hist-export-pdf">📄 PDF</button>
          <button class="btn sm" id="hist-export-csv">📊 CSV</button>
        </div>
      </div>`;
  }

  function renderStats(stats) {
    return `
      <div class="result-stats" style="margin-bottom:20px;">
        <div class="result-stat"><div class="result-stat-label">Affichés</div><div class="result-stat-value">${stats.nb} / ${state.total}</div></div>
        <div class="result-stat"><div class="result-stat-label">✅ Gagnés</div><div class="result-stat-value pos">${stats.gagnes}</div></div>
        <div class="result-stat"><div class="result-stat-label">❌ Perdus</div><div class="result-stat-value neg">${stats.perdus}</div></div>
        <div class="result-stat"><div class="result-stat-label">⏳ En attente</div><div class="result-stat-value">${stats.attente}</div></div>
        <div class="result-stat"><div class="result-stat-label">Taux</div><div class="result-stat-value">${fmt(stats.taux, 1)}%</div></div>
      </div>`;
  }

  function renderEntry(e, showDelete) {
    const matchNom = (e.equipe1 || e.equipe2) ? `${e.equipe1 || '?'} vs ${e.equipe2 || '?'}` : `Match #${e.idx + 1}`;
    let statusClass = 'pending', statusLabel = '⏳ En attente';
    if (e.statut) {
      if (e.Ri !== null && e.Ri >= 0) { statusClass = 'win'; statusLabel = '✅ Gagné'; }
      else { statusClass = 'loss'; statusLabel = '❌ Perdu'; }
    }

    let gainBlock = '';
    if (isAdmin()) {
      const riTxt = e.Ri !== null ? `${e.Ri >= 0 ? '+' : ''}${fmt(e.Ri)} XAF` : '—';
      const riCls = e.Ri === null ? '' : (e.Ri >= 0 ? 'pos' : 'neg');
      gainBlock = `<div class="hist-card-gain ${riCls}">Ri : ${riTxt}</div>`;
    } else if (e.gainCredite) {
      gainBlock = `<div class="hist-card-gain-detail">
        Gain crédité : <strong style="color:var(--vert);">${fmt(e.gainCredite)} XAF</strong></div>`;
    }

    const deleteBtn = showDelete ? `
      <button class="btn ghost sm" data-delete-saisie="${e.saisieId}">🗑️</button>` : '';

    return `
      <div class="hist-card ${statusClass}">
        <div class="hist-card-head">
          <div class="hist-card-match">⚽ ${esc(matchNom)}</div>
          <div class="hist-card-date">📅 ${esc(e.date)} · ${esc(e.moment || '')}</div>
        </div>
        <div class="hist-card-meta">
          <span class="tag tag-tab">T${e.tableauChoisi}</span>
          <span class="tag tag-status tag-${statusClass}">${statusLabel}</span>
          <span>W1 : <strong>${Number(e.cotes['1']).toFixed(2)}</strong></span>
          <span>X : <strong>${Number(e.cotes['N']).toFixed(2)}</strong></span>
          <span>W2 : <strong>${Number(e.cotes['2']).toFixed(2)}</strong></span>
          <span>Mise : <strong>${fmt(e.mise)} XAF</strong></span>
          ${e.statut ? `<span>Résultat : <strong>${lblCol(e.statut)}</strong></span>` : ''}
          ${e.multiplicateur > 1 ? `<span>×${e.multiplicateur}</span>` : ''}
        </div>
        <div class="hist-card-foot">
          ${gainBlock}
          ${deleteBtn}
        </div>
      </div>`;
  }

  function renderList() {
    const filtered = applyClientFilters();

    if (filtered.length === 0) {
      return `<div class="glass empty" style="padding:40px;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:10px;">📭</div>
        <div style="color:var(--txt-dim);">Aucun résultat pour ces filtres</div>
      </div>`;
    }

    const seenSaisies = new Set();
    const cards = filtered.map(e => {
      const showDelete = !seenSaisies.has(e.saisieId);
      seenSaisies.add(e.saisieId);
      return renderEntry(e, showDelete);
    }).join('');

    const totalPages = Math.ceil(state.total / state.perPage);
    const pagination = totalPages > 1 ? `
      <div class="hist-pagination">
        <button class="btn ghost sm" ${state.page === 1 ? 'disabled' : ''} data-page="${state.page - 1}">← Précédent</button>
        <span class="hist-pagination-info">Page ${state.page} / ${totalPages} · ${state.total} entrées</span>
        <button class="btn ghost sm" ${!state.hasMore ? 'disabled' : ''} data-page="${state.page + 1}">Suivant →</button>
      </div>` : '';

    return `<div class="hist-list">${cards}</div>${pagination}`;
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* RENDU PRINCIPAL                                               */
  /* ═══════════════════════════════════════════════════════════════ */
  async function render() {
    const el = document.getElementById('view-history');
    if (!el) return;

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
        <h2 style="margin:0;">📜 Historique</h2>
        <div class="tab-switch" id="hist-view-switch">
          <button data-view="saisies" class="${state.activeTab === 'saisies' ? 'active' : ''}">⚽ Saisies</button>
          <button data-view="transactions" class="${state.activeTab === 'transactions' ? 'active' : ''}">💳 Transactions</button>
        </div>
      </div>
      <div id="hist-content">
        <div class="glass" style="padding:32px;text-align:center;">
          <span class="spinner"></span>
          <div style="color:var(--txt-dim);margin-top:10px;">Chargement…</div>
        </div>
      </div>
    `;

    el.querySelectorAll('#hist-view-switch button').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.activeTab = btn.dataset.view;
        el.querySelectorAll('#hist-view-switch button').forEach(b =>
          b.classList.toggle('active', b === btn)
        );
        await renderContent();
      });
    });

    await renderContent();
  }

  async function renderContent() {
    if (state.activeTab === 'transactions') {
      await renderTransactions();
    } else {
      await renderSaisies();
    }
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* ONGLET SAISIES                                                */
  /* ═══════════════════════════════════════════════════════════════ */
  async function renderSaisies() {
    const container = document.getElementById('hist-content');
    if (!container) return;

    container.innerHTML = '<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span></div>';

    await loadPage();
    const stats = computeStats(applyClientFilters());

    container.innerHTML = `
      ${renderFilters()}
      ${renderStats(stats)}
      <div id="hist-list-container">${renderList()}</div>
    `;

    bindSaisieEvents();
    updateCounter();
  }

  function bindSaisieEvents() {
    const el = document.getElementById('view-history');
    if (!el) return;

    let searchTimer = null;
    document.getElementById('hist-search')?.addEventListener('input', e => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.filters.search = e.target.value;
        refreshSaisieList();
      }, 250);
    });

    ['from', 'to'].forEach(k => {
      const id = k === 'from' ? 'hist-from' : 'hist-to';
      document.getElementById(id)?.addEventListener('change', async e => {
        state.filters[k === 'from' ? 'dateFrom' : 'dateTo'] = e.target.value;
        state.page = 1;
        await loadPage();
        refreshSaisieAll();
      });
    });

    document.getElementById('hist-statut')?.addEventListener('change', e => { state.filters.statut = e.target.value; refreshSaisieList(); });
    document.getElementById('hist-tableau')?.addEventListener('change', e => { state.filters.tableau = e.target.value; refreshSaisieList(); });
    document.getElementById('hist-type')?.addEventListener('change', e => { state.filters.typeResult = e.target.value; refreshSaisieList(); });
    document.getElementById('hist-sort')?.addEventListener('change', e => { state.filters.sort = e.target.value; refreshSaisieList(); });

    document.getElementById('hist-reset')?.addEventListener('click', () => {
      state.filters = { search: '', dateFrom: '', dateTo: '', statut: '', tableau: '', typeResult: '', sort: 'date_desc' };
      state.page = 1;
      render();
    });

    document.getElementById('hist-export-pdf')?.addEventListener('click', exportPDF);
    document.getElementById('hist-export-csv')?.addEventListener('click', exportCSV);

    el.addEventListener('click', async (ev) => {
      const pageBtn = ev.target.closest('[data-page]');
      if (pageBtn) {
        state.page = Number(pageBtn.dataset.page);
        await loadPage();
        refreshSaisieAll();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      const delBtn = ev.target.closest('[data-delete-saisie]');
      if (delBtn) {
        const saisieId = delBtn.dataset.deleteSaisie;
        const ok = await UI.confirm(
          `Supprimer cette saisie ?<br><br><strong>Attention :</strong> les mises ne seront pas remboursées.`,
          '🗑️ Suppression', { html: true, danger: true, confirmText: 'Supprimer' });
        if (!ok) return;
        try {
          await UI.withLoader(async () => { await API.del(`/historique/${saisieId}`); });
          UI.toast('Saisie supprimée', 'info');
          await render();
        } catch (e) {
          UI.toast('❌ ' + (e.data?.error || e.message), 'error', 5000);
        }
      }
    });
  }

  function refreshSaisieAll() {
    const stats = computeStats(applyClientFilters());
    document.querySelectorAll('#view-history .result-stats').forEach(n => n.remove());
    const listEl = document.getElementById('hist-list-container');
    if (listEl) listEl.innerHTML = renderList();
    const filtersEl = document.querySelector('#view-history .hist-filters');
    if (filtersEl) {
      filtersEl.insertAdjacentHTML('afterend', renderStats(stats));
    }
    updateCounter();
  }

  function refreshSaisieList() {
    refreshSaisieAll();
  }

  function updateCounter() {
    const el = document.getElementById('hist-counter');
    if (!el) return;
    el.textContent = `${state.total} résultat(s)`;
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* ONGLET TRANSACTIONS                                           */
  /* ═══════════════════════════════════════════════════════════════ */
  async function renderTransactions() {
    const container = document.getElementById('hist-content');
    if (!container) return;

    container.innerHTML = `
      <div class="glass" style="padding:20px;margin-bottom:20px;">
        <div class="hist-filter-row">
          <select class="input" id="tx-type-filter">
            <option value="">📊 Tous types</option>
            <option value="deposit">💰 Dépôts</option>
            <option value="withdraw">💸 Retraits</option>
            <option value="bet">🎯 Paris</option>
            <option value="win">🏆 Gains</option>
            <option value="bonus">🎁 Bonus</option>
            <option value="subscription">💎 Abonnements</option>
            <option value="adjust">⚙️ Ajustements</option>
          </select>
          <button class="btn ghost sm" id="tx-refresh">🔄 Recharger</button>
          <span class="hist-counter" id="tx-counter" style="margin-left:auto;color:var(--txt-dim);font-size:.85rem;"></span>
        </div>
      </div>
      <div id="tx-list-container">
        <div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span></div>
      </div>
    `;

    async function loadTx() {
      const type = document.getElementById('tx-type-filter')?.value || '';
      const listEl = document.getElementById('tx-list-container');
      const counterEl = document.getElementById('tx-counter');
      if (!listEl) return;

      listEl.innerHTML = '<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span></div>';

      try {
        const r = await API.get(`/transactions?limit=100${type ? '&type=' + type : ''}`);
        const entries = r.entries || [];

        if (counterEl) {
          counterEl.textContent = `${r.total || entries.length} transaction(s)`;
        }

        if (!entries.length) {
          listEl.innerHTML = `
            <div class="glass empty" style="padding:40px;text-align:center;">
              <div style="font-size:2.5rem;margin-bottom:10px;">📭</div>
              <div style="color:var(--txt-dim);">Aucune transaction.</div>
            </div>`;
          return;
        }

        listEl.innerHTML = `
          <div class="hist-list">
            ${entries.map(tx => renderTransactionCard(tx)).join('')}
          </div>
        `;
      } catch (e) {
        listEl.innerHTML = `
          <div class="glass empty" style="color:var(--rouge);padding:24px;">
            Erreur : ${esc(e.message)}
          </div>`;
      }
    }

    document.getElementById('tx-refresh')?.addEventListener('click', loadTx);
    document.getElementById('tx-type-filter')?.addEventListener('change', loadTx);

    await loadTx();
  }

  function renderTransactionCard(tx) {
    const meta = {
      deposit:      { icon: '💰', label: 'Dépôt',      color: 'var(--vert)' },
      withdraw:     { icon: '💸', label: 'Retrait',    color: 'var(--orange)' },
      bet:          { icon: '🎯', label: 'Mise',       color: 'var(--cyan)' },
      win:          { icon: '🏆', label: 'Gain',       color: 'var(--vert)' },
      bonus:        { icon: '🎁', label: 'Bonus',      color: 'var(--violet)' },
      subscription: { icon: '💎', label: 'Abonnement', color: '#f59e0b' },
      adjust:       { icon: '⚙️', label: 'Ajustement', color: 'var(--txt-dim)' }
    }[tx.type] || { icon: '•', label: tx.type, color: 'var(--txt-dim)' };

    const signe = tx.montant >= 0 ? '+' : '';
    const cls = tx.montant >= 0 ? 'pos' : 'neg';

    /* Statut lisible depuis la note (PENDING/SUCCESS/FAILED) */
    const note = String(tx.note || '');
    let statusBadge = '';
    if (note.startsWith('PENDING:')) {
      statusBadge = '<span class="badge-attente" style="margin-left:8px;">⏳ En attente</span>';
    } else if (note.startsWith('FAILED:')) {
      statusBadge = '<span class="badge-warn" style="margin-left:8px;">❌ Échoué</span>';
    } else if (note.startsWith('SUCCESS:')) {
      statusBadge = '<span class="badge-valide" style="margin-left:8px;">✅ Réussi</span>';
    }

    const displayNote = note
      .replace(/^(PENDING|SUCCESS|FAILED):/, '')
      .replace(/^[\d.]+\|[^|]*\|?/, '');

    return `
      <div class="hist-card">
        <div class="hist-card-head">
          <div class="hist-card-match">
            ${meta.icon} <strong style="color:${meta.color};">${meta.label}</strong>
            ${statusBadge}
          </div>
          <div class="hist-card-date">📅 ${new Date(tx.date).toLocaleString('fr-FR')}</div>
        </div>
        <div class="hist-card-meta">
          ${tx.ref_id ? `<span>Réf : <code>${esc(tx.ref_id)}</code></span>` : ''}
          <span>Devise : <strong>${esc(tx.devise)}</strong></span>
        </div>
        <div class="hist-card-foot">
          <div class="hist-card-gain ${cls}" style="font-size:1.1rem;">
            ${signe}${Number(tx.montant).toFixed(2)} XAF
          </div>
          <div style="font-size:.82rem;color:var(--txt-dim);max-width:60%;">
            ${esc(displayNote || tx.note || '')}
          </div>
        </div>
      </div>
    `;
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* EXPORTS (saisies uniquement)                                  */
  /* ═══════════════════════════════════════════════════════════════ */
  function exportPDF() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      return UI.toast('jsPDF non chargé', 'error');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const stats = computeStats(applyClientFilters());
    const user = window.CURRENT_USER?.email || '—';
    const now = new Date().toLocaleString('fr-FR');

    doc.setFontSize(16);
    doc.setTextColor(124, 58, 237);
    doc.text('Me2/3Legend — Historique des paris', 14, 15);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Utilisateur : ${user}`, 14, 22);
    doc.text(`Généré le : ${now}`, 14, 27);
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.text(`Matchs : ${stats.nb} · Gagnés : ${stats.gagnes} · Perdus : ${stats.perdus}`, 14, 42);

    const filtered = applyClientFilters();
    const headers = ['Date', 'Match', 'T', 'Cotes', 'Résultat', 'Mise'];
    const colWidths = [22, 80, 15, 55, 25, 30];
    let y = 52;
    const lineH = 7;

    doc.setFontSize(9);
    doc.setFillColor(240, 240, 250);
    doc.rect(14, y - 5, 273, 7, 'F');
    doc.setTextColor(80);
    let x = 14;
    headers.forEach((h, i) => { doc.text(h, x + 1, y); x += colWidths[i]; });
    y += lineH;

    doc.setTextColor(0);
    filtered.forEach(e => {
      if (y > 195) { doc.addPage(); y = 20; }
      const matchNom = `${(e.equipe1 || '?').substring(0, 24)} vs ${(e.equipe2 || '?').substring(0, 24)}`;
      const cotes = `${Number(e.cotes['1']).toFixed(2)} / ${Number(e.cotes['N']).toFixed(2)} / ${Number(e.cotes['2']).toFixed(2)}`;
      const statut = e.statut ? lblCol(e.statut) : '⏳';
      x = 14;
      const row = [e.date, matchNom, `T${e.tableauChoisi}`, cotes, statut, e.mise.toFixed(2)];
      row.forEach((v, i) => { doc.text(String(v), x + 1, y); x += colWidths[i]; });
      y += lineH;
    });

    doc.save(`historique_${new Date().toISOString().slice(0, 10)}.pdf`);
    UI.toast('📄 PDF exporté', 'success');
  }

  function exportCSV() {
    const filtered = applyClientFilters();
    const headers = ['date', 'match', 'tableau', 'cote_W1', 'cote_X', 'cote_W2', 'statut', 'mise'];
    const rows = filtered.map(e => [
      e.date,
      `${e.equipe1 || '?'} vs ${e.equipe2 || '?'}`,
      `T${e.tableauChoisi}`,
      Number(e.cotes['1']).toFixed(2),
      Number(e.cotes['N']).toFixed(2),
      Number(e.cotes['2']).toFixed(2),
      e.statut ? lblCol(e.statut) : 'attente',
      e.mise.toFixed(2)
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `historique_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast('📊 CSV exporté', 'success');
  }

  Navigation.register('history', render);
})();