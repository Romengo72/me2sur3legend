// C:\Me\AppMoney\MeParisPortifs\js\ia.js
// v6.2.4 — Fix "isExternal is not defined" : suppression des références obsolètes
//         • Bouton "Utiliser" actif pour tous (match issu de la liste IA)
//         • Bouton "Prédire" réservé VIP/Légendaire/Admin
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const state = {
    matches: [],
    facettes: { sports: [], pays: [] },
    filters: { search: '', sport: '', pays: '', date: '', sort: 'commence_asc' }
  };

  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
  const esc = (s) => (window.APP && window.APP._esc)
    ? window.APP._esc(s) : String(s ?? '');

  async function renderSuggestion() {
    const el = document.getElementById('view-suggestion');
    if (!el) return;
    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;

    try { await loadMatches(); } catch (e) { console.error(e); }

    const isAdmin = window.CURRENT_USER && window.CURRENT_USER.role === 'admin';
    const displayBtn = isAdmin ? 'inline-flex' : 'none';

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <h2 style="margin:0;">🔍 Suggestion de matchs</h2>
        <button class="btn sm" id="ia-sync-btn" style="display:${displayBtn}; background:linear-gradient(135deg,#f59e0b,#ef4444);">⚡ Générer les matchs</button>
      </div>

      <div class="hist-filters glass" style="margin-bottom:20px;">
        <div class="hist-filter-row">
          <input type="text" class="input" id="ia-search" placeholder="🔍 Rechercher une équipe…" value="${esc(state.filters.search)}">
          <input type="date" class="input" id="ia-date" title="Sélectionner une date" value="${esc(state.filters.date)}">
          <select class="input" id="ia-sport">
            <option value="">🏅 Toutes disciplines</option>
            ${(state.facettes.sports || []).map(s => `<option value="${esc(s)}" ${state.filters.sport === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
          <select class="input" id="ia-pays">
            <option value="">🌍 Tous pays</option>
            ${(state.facettes.pays || []).map(p => `<option value="${esc(p)}" ${state.filters.pays === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div class="hist-filter-row right">
          <span class="hist-counter">${state.matches.length} match(s)</span>
          <button class="btn ghost sm" id="ia-refresh">🔄 Recharger</button>
        </div>
      </div>

      <div id="ia-matches-container" class="ia-matches-grid">
        ${state.matches.length === 0 ? `
          <div class="glass empty" style="grid-column:1/-1;padding:40px;text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:10px;">📭</div>
            <div style="color:var(--txt-dim);">Aucun match disponible pour cette date.</div>
          </div>
        ` : state.matches.map(renderMatchCard).join('')}
      </div>
    `;

    bindEvents();
  }

  function renderMatchCard(m) {
    const dateStr = m.commence_at
      ? new Date(m.commence_at).toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        })
      : '—';

    /* Prédiction : VIP / Légendaire / Admin uniquement */
    const isVip = ['vip', 'legendaire'].includes(window.CURRENT_USER?.category)
      || window.CURRENT_USER?.role === 'admin';

    const predictBtn = isVip
      ? `<button type="button" class="btn ghost sm" data-action="predict" data-id="${m.id}">🤖 Prédire</button>`
      : `<button type="button" class="btn ghost sm" disabled style="opacity:.45;" title="Réservé aux membres VIP">🔒 Prédire (VIP)</button>`;

    /* Utilisation : active pour TOUS (match issu de la liste IA) */
    const useBtn = `<button type="button" class="btn sm" data-action="use" data-id="${m.id}">➕ Utiliser</button>`;

    return `
      <div class="ia-match-card glass" data-id="${m.id}">
        <div class="ia-match-head">
          <div class="ia-match-league">🏅 ${esc(m.sport || 'Sport')} · 🌍 ${esc(m.pays || 'Int.')}</div>
          <span class="ia-badge avenir">🕐 À venir</span>
        </div>
        <div class="ia-match-teams">
          <div class="ia-team home">${esc(m.equipe1 || '?')}</div>
          <div class="ia-vs">VS</div>
          <div class="ia-team away">${esc(m.equipe2 || '?')}</div>
        </div>
        <div class="ia-match-date">🏆 ${esc(m.league || '')} · 📅 ${dateStr}</div>
        <div class="ia-match-cotes">
          <div class="ia-cote"><span class="ia-cote-lbl">W1</span><span class="ia-cote-val">${fmt(m.cote_w1)}</span></div>
          <div class="ia-cote"><span class="ia-cote-lbl">X</span><span class="ia-cote-val">${fmt(m.cote_x)}</span></div>
          <div class="ia-cote"><span class="ia-cote-lbl">W2</span><span class="ia-cote-val">${fmt(m.cote_w2)}</span></div>
        </div>
        <div class="ia-match-actions">
          ${predictBtn}
          ${useBtn}
        </div>
      </div>
    `;
  }

    async function loadMatches() {
    const params = new URLSearchParams(state.filters);
    params.set('limit', '200');
    try {
      const r = await API.get(`/matches?${params.toString()}`);
      const now = Date.now();

      state.matches = (r.matches || [])
        /* ⭐ v6.2.6 : exclure les matchs déjà commencés */
        .filter(m => {
          if (!m.commence_at) return true;
          return new Date(m.commence_at).getTime() > now;
        })
        /* ⭐ v6.2.6 : tri chronologique par défaut (commence_at ASC) */
        .sort((a, b) => {
          const ta = a.commence_at ? new Date(a.commence_at).getTime() : Infinity;
          const tb = b.commence_at ? new Date(b.commence_at).getTime() : Infinity;
          return ta - tb;
        })
        .map(m => {
          const cotesAjustees = CALC.ajusterCotesAvecMarge({
            '1': m.cote_w1, 'N': m.cote_x, '2': m.cote_w2
          });
          return {
            ...m,
            cote_w1: cotesAjustees['1'],
            cote_x:  cotesAjustees['N'],
            cote_w2: cotesAjustees['2']
          };
        });

      state.facettes = r.facettes || { sports: [], pays: [] };
    } catch (e) {
      state.matches = [];
    }
  }
  
  function bindEvents() {
    const el = document.getElementById('view-suggestion');
    let timer = null;

    el.querySelector('#ia-search')?.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        state.filters.search = e.target.value;
        await renderSuggestion();
      }, 300);
    });

    el.querySelector('#ia-date')?.addEventListener('change', async e => {
      state.filters.date = e.target.value;
      await renderSuggestion();
    });

    ['sport', 'pays'].forEach(f => {
      el.querySelector(`#ia-${f}`)?.addEventListener('change', async e => {
        state.filters[f] = e.target.value;
        await renderSuggestion();
      });
    });

    el.querySelector('#ia-refresh')?.addEventListener('click', renderSuggestion);
    el.querySelector('#ia-sync-btn')?.addEventListener('click', syncMatches);

    el.querySelectorAll('[data-action="predict"]').forEach(b =>
      b.addEventListener('click', () => predictMatch(b.dataset.id)));

    el.querySelectorAll('[data-action="use"]').forEach(b =>
      b.addEventListener('click', () => useMatch(b.dataset.id)));
  }

  async function syncMatches() {
    if (!await UI.confirm('Lancer la synchronisation ?', '⚡ Synchronisation')) return;
    try {
      let r;
      await UI.withLoader(async () => { r = await API.post('/matches/sync', {}); });
      UI.toast(`✅ ${r.fetched} récupérés · ${r.inserted} ajoutés`, 'success');
      await renderSuggestion();
    } catch (e) {
      UI.toast('❌ ' + e.message, 'error');
    }
  }

  async function predictMatch(id) {
    const m = state.matches.find(x => String(x.id) === String(id));
    if (!m) return;
    try {
      let r;
      await UI.withLoader(async () => {
        r = await API.post('/ia/predict', {
          equipe1: m.equipe1,
          equipe2: m.equipe2,
          cotes: { '1': m.cote_w1, 'N': m.cote_x, '2': m.cote_w2 }
        });
      });
      UI.toast(`🤖 IA : ${r.prediction} (${r.confidence}%)`, 'success');
    } catch (e) {
      UI.toast('❌ ' + (e.data?.error || e.message), 'error', 6000);
    }
  }

  function useMatch(id) {
    const m = state.matches.find(x => String(x.id) === String(id));
    if (!m) return;

    sessionStorage.setItem('ia-pending-match', JSON.stringify({
      equipe1: m.equipe1,
      equipe2: m.equipe2,
      cotes: { '1': m.cote_w1, 'N': m.cote_x, '2': m.cote_w2 },
      _external_id: m.external_id
    }));

    UI.toast('✅ Match copié, redirection vers Saisie', 'success');
    setTimeout(() => Navigation.go('saisie'), 600);
  }

  Navigation.register('suggestion', renderSuggestion);
})();