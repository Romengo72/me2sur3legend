// C:\Me\AppMoney\MeParisPortifs\js\ia-vip.js
// v6.2.8 — prestige → legendaire, API.get, gestion erreurs
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const state = { matches: [], facettes: { pays: [], leagues: [] }, filters: { search: '', pays: '', league: '' } };
  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => (window.APP && window.APP._esc) ? window.APP._esc(s) : String(s ?? '');

  async function render() {
    const el = document.getElementById('view-ia-vip');
    if (!el) return;

    /* ⭐ v6.2.8 : prestige → legendaire */
    const isVip = ['vip', 'legendaire'].includes(window.CURRENT_USER?.category) || window.CURRENT_USER?.role === 'admin';
    if (!isVip) {
      el.innerHTML = `<div class="glass empty" style="padding:50px;text-align:center;"><div style="font-size:3rem;margin-bottom:16px;">👑</div><h2>Réservé aux membres VIP</h2></div>`;
      return;
    }

    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;
    await loadMatches();

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div>
          <h2 style="margin:0;">👑 Matchs VIP — Cotes IA</h2>
          <p style="color:var(--txt-dim);font-size:.85rem;margin-top:4px;">Matchs réels · Cotes optimisées · Comparaison avec le marché</p>
        </div>
        <button class="btn ghost sm" id="vip-ia-refresh">🔄 Recharger</button>
      </div>

      <div class="hist-filters glass" style="margin-bottom:20px;">
        <div class="hist-filter-row">
          <input type="text" class="input" id="vip-ia-search" placeholder="🔍 Équipe…" value="${esc(state.filters.search)}">
          <select class="input" id="vip-ia-pays">
            <option value="">🌍 Tous pays</option>
            ${state.facettes.pays.map(p => `<option value="${esc(p)}" ${state.filters.pays === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
          </select>
          <select class="input" id="vip-ia-league">
            <option value="">🏆 Toutes ligues</option>
            ${state.facettes.leagues.map(l => `<option value="${esc(l)}" ${state.filters.league === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
        </div>
        <div class="hist-filter-row right">
          <span class="hist-counter">${state.matches.length} match(s)</span>
        </div>
      </div>

      <div id="vip-ia-list" class="ia-matches-grid">
        ${state.matches.length === 0 ? `<div class="glass empty" style="grid-column:1/-1;padding:40px;text-align:center;"><div style="color:var(--txt-dim);">Aucun match disponible.</div></div>` : state.matches.map(renderMatchCard).join('')}
      </div>
    `;
    bindEvents();
  }

  function renderMatchCard(m) {
    const dateStr = m.commence_at ? new Date(m.commence_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

    const compare = (coteIA, coteMarche) => {
      if (!coteIA || !coteMarche) return '';
      const diff = ((Number(coteIA) - Number(coteMarche)) / Number(coteMarche) * 100).toFixed(1);
      const color = Number(diff) > 0 ? 'var(--vert)' : 'var(--rouge)';
      return `<span style="font-size:.7rem;color:${color};">${Number(diff) > 0 ? '+' : ''}${diff}% vs marché</span>`;
    };

    return `
      <div class="ia-match-card glass ia-vip-card" data-id="${m.id}">
        <div class="ia-match-head">
          <div class="ia-match-league">🌍 ${esc(m.pays || 'Int.')} · 🏆 ${esc(m.league || '—')}</div>
          <span class="ia-badge" style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;">👑 IA VIP</span>
        </div>
        <div class="ia-match-teams">
          <div class="ia-team home">${esc(m.equipe1 || '?')}</div>
          <div class="ia-vs">VS</div>
          <div class="ia-team away">${esc(m.equipe2 || '?')}</div>
        </div>
        <div class="ia-match-date">📅 ${dateStr}</div>

        <div class="ia-match-cotes ia-cotes-vip">
          <div class="ia-cote"><span class="ia-cote-lbl">W1 IA</span><span class="ia-cote-val">${fmt(m.cote_w1)}</span>${compare(m.cote_w1, m.marche_w1)}</div>
          <div class="ia-cote"><span class="ia-cote-lbl">X IA</span><span class="ia-cote-val">${fmt(m.cote_x)}</span>${compare(m.cote_x, m.marche_x)}</div>
          <div class="ia-cote"><span class="ia-cote-lbl">W2 IA</span><span class="ia-cote-val">${fmt(m.cote_w2)}</span>${compare(m.cote_w2, m.marche_w2)}</div>
        </div>

        <div style="display:flex;justify-content:space-around;gap:6px;font-size:.72rem;color:var(--txt-dim);padding:6px 0;border-top:1px dashed var(--glass-brd);">
          <span>Marché : <strong>${fmt(m.marche_w1)}</strong></span>
          <span>${fmt(m.marche_x)}</span>
          <span>${fmt(m.marche_w2)}</span>
        </div>

        ${m.ia_confidence ? `<div style="display:flex;justify-content:space-between;gap:10px;font-size:.75rem;color:var(--txt-dim);padding-top:8px;"><span>🎯 Confiance IA : <strong style="color:var(--cyan);">${m.ia_confidence}%</strong></span></div>` : ''}
        ${m.ia_raison ? `<div style="font-size:.75rem;color:var(--txt-dim);font-style:italic;padding:8px 10px;background:rgba(124,58,237,.08);border-radius:8px;margin-top:6px;">🤖 ${esc(m.ia_raison)}</div>` : ''}

        <div class="ia-match-actions">
          <button type="button" class="btn sm" data-action="use" data-id="${m.id}">➕ Utiliser</button>
        </div>
      </div>
    `;
  }

  async function loadMatches() {
    const params = new URLSearchParams(state.filters);
    params.set('limit', '200');
    try {
      const r = await API.get(`/matches/vip-ia?${params.toString()}`);
      const now = Date.now();

      state.matches = (r.matches || [])
        .filter(m => {
          if (!m.commence_at) return true;
          return new Date(m.commence_at).getTime() > now;
        })
        .sort((a, b) => {
          const ta = a.commence_at ? new Date(a.commence_at).getTime() : Infinity;
          const tb = b.commence_at ? new Date(b.commence_at).getTime() : Infinity;
          return ta - tb;
        })
        .map(m => {
          const cotesAjustees = CALC.ajusterCotesAvecMarge({ '1': m.cote_w1, 'N': m.cote_x, '2': m.cote_w2 });
          return { ...m, cote_w1: cotesAjustees['1'], cote_x: cotesAjustees['N'], cote_w2: cotesAjustees['2'] };
        });

      state.facettes = r.facettes || { pays: [], leagues: [] };
    } catch (e) {
      console.error('[ia-vip] loadMatches:', e.message);
      state.matches = [];
    }
  }

  function bindEvents() {
    const el = document.getElementById('view-ia-vip');
    let timer = null;
    document.getElementById('vip-ia-search')?.addEventListener('input', e => {
      clearTimeout(timer);
      timer = setTimeout(async () => { state.filters.search = e.target.value; await render(); }, 300);
    });
    ['pays', 'league'].forEach(f => {
      document.getElementById(`vip-ia-${f}`)?.addEventListener('change', async e => { state.filters[f] = e.target.value; await render(); });
    });
    document.getElementById('vip-ia-refresh')?.addEventListener('click', render);
    el.querySelectorAll('[data-action="use"]').forEach(b => b.addEventListener('click', () => useMatch(b.dataset.id)));
  }

  function useMatch(id) {
    const m = state.matches.find(x => String(x.id) === String(id));
    if (!m) return;
    sessionStorage.setItem('ia-pending-match', JSON.stringify({
      equipe1: m.equipe1, equipe2: m.equipe2,
      cotes: { '1': m.cote_w1, 'N': m.cote_x, '2': m.cote_w2 },
      _external_id: m.external_id
    }));
    UI.toast('✅ Match copié — redirection vers Saisie', 'success');
    setTimeout(() => Navigation.go('saisie'), 600);
  }

  Navigation.register('ia-vip', render);
})();