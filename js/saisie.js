// C:\Me\AppMoney\MeParisPortifs\js\saisie.js
// v6.2.3 — Saisie manuelle VIP+ / vérification auto des cotes / IA réservée VIP
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const state = {
    constantes: null,
    multiplicateur: 1,
    matchs: [],
    verif: {}          /* cache de vérification par match.id */
  };
  const uid = () => 'm_' + Math.random().toString(36).slice(2, 9);

  const CATEGORIES_MANUEL = ['vip', 'legendaire'];

  function peutSaisirManuellement() {
    const u = window.CURRENT_USER;
    if (!u) return false;
    if (u.role === 'admin') return true;
    return CATEGORIES_MANUEL.includes(u.category);
  }

  function todayLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function newMatch() {
    return { id: uid(), equipe1: '', equipe2: '', cotes: { '1': '', 'N': '', '2': '' }, tableauChoisi: 1, _external_id: null };
  }

  function cotesComplete(m) {
    return m.cotes['1'] !== '' && m.cotes['N'] !== '' && m.cotes['2'] !== ''
      && !isNaN(Number(m.cotes['1'])) && !isNaN(Number(m.cotes['N'])) && !isNaN(Number(m.cotes['2']))
      && Number(m.cotes['1']) > 1 && Number(m.cotes['N']) > 1 && Number(m.cotes['2']) > 1;
  }

  const fmt = (v, dec = 2) => Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const labelCol = (col) => col === '1' ? 'W1' : col === 'N' ? 'X' : 'W2';

  /* ═══════════════════════════════════════════════════════════════ */
  /* Vérification automatique de la plausibilité des cotes           */
  /* ═══════════════════════════════════════════════════════════════ */
    async function verifierMatch(matchId) {
    const m = state.matchs.find(x => x.id === matchId);
    if (!m || !cotesComplete(m)) {
      state.verif[matchId] = null;
      return;
    }

    /* ⭐ v6.2.5 : vérification mathématique locale immédiate (filet de sécurité) */
    const c1 = Number(m.cotes['1']);
    const cN = Number(m.cotes['N']);
    const c2 = Number(m.cotes['2']);
    const sommeProbas = 1/c1 + 1/cN + 1/c2;
    const localesRaisons = [];
    let localesConfiance = 100;

    if (sommeProbas < 0.85) {
      localesRaisons.push(
        `Marge bookmaker anormalement basse (${(sommeProbas * 100).toFixed(1)}%, normal ≈ 105-115%).`
      );
      localesConfiance -= 45;
    }
    if ([c1, cN, c2].filter(c => c > 10).length >= 2) {
      localesRaisons.push(`Plusieurs cotes > 10 simultanément.`);
      localesConfiance -= 35;
    }
    if ([c1, cN, c2].some(c => c > 30)) {
      localesRaisons.push(`Cote très élevée (> 30).`);
      localesConfiance -= 25;
    }
    localesConfiance = Math.max(0, localesConfiance);

    state.verif[matchId] = {
      loading: true,
      valide: localesConfiance >= 50,
      confiance: localesConfiance,
      raisons: localesRaisons,
      local: true
    };
    const card = document.querySelector(`.match-card[data-id="${matchId}"]`);
    if (card) refreshVerifBlock(card, m);

    /* Puis appel serveur pour affiner */
    try {
      const r = await API.post('/ia/verify-match', {
        equipe1: m.equipe1 || '',
        equipe2: m.equipe2 || '',
        cotes: {
          '1': String(m.cotes['1']),
          'N': String(m.cotes['N']),
          '2': String(m.cotes['2'])
        }
      });
      state.verif[matchId] = r;
    } catch (e) {
      /* ⭐ v6.2.5 : log l'erreur réelle pour diagnostic */
      console.warn('[verifierMatch] Erreur API :', {
        status: e.status,
        message: e.message,
        data: e.data
      });

      if (e.status === 404) {
        /* Route absente : on garde la vérification locale */
        state.verif[matchId] = {
          valide: localesConfiance >= 50,
          confiance: localesConfiance,
          raisons: [
            ...localesRaisons,
            'Vérification serveur indisponible (route manquante) — vérification locale appliquée.'
          ],
          local: true
        };
      } else if (e.status === 0 || e.network) {
        /* Erreur réseau : on garde la vérification locale */
        state.verif[matchId] = {
          valide: localesConfiance >= 50,
          confiance: localesConfiance,
          raisons: [
            ...localesRaisons,
            'Hors ligne — vérification locale appliquée.'
          ],
          local: true
        };
      } else {
        /* Erreur serveur (500, etc.) : on garde la vérification locale */
        state.verif[matchId] = {
          valide: localesConfiance >= 50,
          confiance: localesConfiance,
          raisons: [
            ...localesRaisons,
            `Vérification serveur en erreur (${e.status || 'inconnu'}) — vérification locale appliquée.`
          ],
          local: true
        };
      }
    }

    const card2 = document.querySelector(`.match-card[data-id="${matchId}"]`);
    if (card2) refreshVerifBlock(card2, m);
  }

    function renderVerifBlock(m) {
    const v = state.verif[m.id];
    if (!v) return '';

    if (v.loading) {
      return `<div class="match-warning" style="background:rgba(124,58,237,.1);border-left-color:var(--violet);">
        <span class="match-warning-icon">⏳</span>
        <span class="match-warning-msg">Vérification des cotes en cours…</span>
      </div>`;
    }

    /* Bonne confiance, aucune raison */
    if (v.valide && (!v.raisons || v.raisons.length === 0)) {
      return `<div class="match-warning" style="background:rgba(16,185,129,.1);border-left-color:var(--vert);">
        <span class="match-warning-icon">✅</span>
        <span class="match-warning-msg">Cotes plausibles (confiance ${v.confiance}%).</span>
      </div>`;
    }

    /* Confiance moyenne avec raisons (mais valide) */
    if (v.valide && v.raisons && v.raisons.length > 0) {
      const suffix = v.local ? ' <em style="opacity:.7;">(local)</em>' : '';
      return `<div class="match-warning">
        <span class="match-warning-icon">⚠️</span>
        <span class="match-warning-msg">
          Cotes plausibles avec réserves (confiance ${v.confiance}%)${suffix} :
          <ul style="margin:6px 0 0 18px;padding:0;font-size:.82rem;">
            ${v.raisons.map(r => `<li>${window.APP._esc(r)}</li>`).join('')}
          </ul>
        </span>
      </div>`;
    }

    /* Invalide */
    const suffix = v.local ? ' <em style="opacity:.7;">(local)</em>' : '';
    return `<div class="match-warning" style="background:rgba(239,68,68,.12);border-left-color:var(--rouge);">
      <span class="match-warning-icon">🚫</span>
      <span class="match-warning-msg">
        <strong style="color:var(--rouge);">Cotes non plausibles (confiance ${v.confiance}%)${suffix} :</strong>
        <ul style="margin:6px 0 0 18px;padding:0;font-size:.82rem;">
          ${v.raisons.map(r => `<li>${window.APP._esc(r)}</li>`).join('')}
        </ul>
        <div style="margin-top:6px;font-size:.82rem;">${window.APP._esc(v.conseils || '')}</div>
      </span>
    </div>`;
  }

  function refreshVerifBlock(card, m) {
    const old = card.querySelector('.verif-block');
    if (old) old.remove();
    const html = renderVerifBlock(m);
    if (!html) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'verif-block';
    wrapper.innerHTML = html.trim();
    const anchor = card.querySelector('.calc-block') || card.querySelector('.cotes-row');
    if (anchor) anchor.after(wrapper.firstElementChild || wrapper);
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* Rendu principal                                                */
  /* ═══════════════════════════════════════════════════════════════ */
  function render() {
    const el = document.getElementById('view-saisie');
    if (!el) return;

    const peutManuel = peutSaisirManuellement();

    el.innerHTML = `
      <div class="glass saisie-toolbar">
        <div class="toolbar-left">
          <div class="toolbar-label" data-i18n="saisie.multiplier">Multiplicateur</div>
          <div class="tab-switch" id="mult-switch">
            ${window.APP.MULTIPLICATEURS.map(v => `<button type="button" data-mult="${v}" class="${v === state.multiplicateur ? 'active' : ''}">×${v}</button>`).join('')}
          </div>
        </div>
        ${peutManuel ? `
          <button type="button" class="btn" id="btn-add-match">
            <span style="font-size:1.1rem">+</span> <span data-i18n="saisie.add_match">Ajouter un match</span>
          </button>
        ` : `
          <button type="button" class="btn ghost" id="btn-add-match" title="Réservé aux membres VIP">
            🔒 Ajouter un match (VIP)
          </button>
        `}
      </div>

      ${!peutManuel ? `
        <div class="glass" style="padding:14px 18px;margin-bottom:16px;background:rgba(124,58,237,.08);border-left:4px solid var(--violet);">
          <div style="font-size:.85rem;color:var(--txt-dim);">
            💡 La saisie manuelle est réservée aux membres VIP/Légendaire.
            Utilisez l'onglet <strong style="color:var(--cyan);">🔍 Suggestions</strong>
            pour choisir un match de la liste, puis cliquez sur <strong>➕ Utiliser</strong>.
          </div>
        </div>
      ` : ''}

      <div class="matchs-grid" id="matchs-container">
        ${state.matchs.length === 0
          ? `<div class="glass empty">Aucun match. ${peutManuel ? 'Cliquez sur « Ajouter un match ».' : 'Allez dans Suggestions pour en choisir un.'}</div>`
          : state.matchs.map(renderMatch).join('')}
      </div>

      ${state.matchs.length > 0 ? `
        <div class="glass saisie-footer">
          <div class="footer-info">
            <div><div class="footer-label">Matchs</div><div class="footer-value">${state.matchs.length}</div></div>
            <div><div class="footer-label" data-i18n="saisie.budget_total">Budget total</div><div class="footer-value" id="footer-budget">—</div></div>
          </div>
          <button type="button" class="btn btn-lg" id="btn-valider">
            ✅ <span data-i18n="saisie.validate">Valider la saisie</span>
          </button>
        </div>
      ` : ''}
    `;

    if (window.I18N) window.I18N.apply();
    bindEvents();
    updateFooterBudget(window.CURRENT_USER?.devise || 'XAF');

    /* Lancer la vérification automatique pour les matchs déjà complets */
    state.matchs.forEach(m => { if (cotesComplete(m)) verifierMatch(m.id); });
  }

  function renderMatch(m) {
    const user = window.CURRENT_USER || { devise: 'XAF' };
    let calc = null, tableaux = null;

    if (cotesComplete(m)) {
      try {
        const cotesSecurisees = CALC.ajusterCotesAvecMarge(m.cotes);
        calc = CALC.calcMises(cotesSecurisees, { constantes: state.constantes || {}, multiplicateur: state.multiplicateur });
        tableaux = CALC.buildTableaux(cotesSecurisees, calc);
      } catch (e) { console.error(e); }
    }

    const externalBadge = m._external_id
      ? `<span class="ia-badge" style="background:linear-gradient(135deg,#22d3ee,#7c3aed);color:#fff;font-size:.65rem;">🤖 IA</span>`
      : `<span class="ia-badge" style="background:rgba(245,158,11,.2);color:var(--orange);font-size:.65rem;">✍️ Manuel</span>`;

    return `
      <div class="match-card glass fade-up" data-id="${m.id}">
        <div class="match-head">
          <input type="text" class="input" data-i18n-placeholder="saisie.team1" placeholder="Équipe 1 (domicile)" value="${window.APP._esc(m.equipe1)}" data-field="equipe1">
          <span class="vs">VS</span>
          <input type="text" class="input" data-i18n-placeholder="saisie.team2" placeholder="Équipe 2 (extérieur)" value="${window.APP._esc(m.equipe2)}" data-field="equipe2">
          <button type="button" class="btn-icon" data-action="remove" title="Supprimer">✕</button>
        </div>
        <div style="margin-bottom:10px;">${externalBadge}</div>
        <div class="cotes-row">
          ${[['1', 'W1', 'Victoire domicile'], ['N', 'X', 'Match nul'], ['2', 'W2', 'Victoire extérieur']].map(([k, lab, tip]) => `
            <label class="cote-input" title="${tip}">
              <span>${lab}</span>
              <input type="number" step="0.001" min="1.01" class="input" placeholder="0.000" value="${m.cotes[k]}" data-cote="${k}">
            </label>
          `).join('')}
        </div>
        <div class="verif-block"></div>
        ${calc && calc.warning ? `<div class="match-warning"><span class="match-warning-icon">⚠️</span><span class="match-warning-msg">${window.APP._esc(calc.warning.message)}</span></div>` : ''}
        ${calc ? renderCalcBlock(m, calc, tableaux, user.devise) : `<div style="padding:14px;text-align:center;color:var(--txt-dim);font-size:.85rem;" data-i18n="saisie.odds_required">Renseignez les 3 cotes pour voir le calcul</div>`}
      </div>
    `;
  }

  function renderCalcBlock(m, calc, T, devise) {
    const activeKey = `T${m.tableauChoisi}`;
    const active = T[activeKey];
    return `
      <div class="calc-block">
        <div class="calc-tabs" style="justify-content:center;">
          <div class="tab-switch" data-tab-group>
            ${[1, 2, 3].map(n => `<button type="button" data-tab="${n}" class="${n === m.tableauChoisi ? 'active' : ''}">T${n}</button>`).join('')}
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0;">
          ${active.map(r => `
            <div style="padding:14px 10px;background:rgba(20,20,42,.5);border-radius:12px;text-align:center;">
              <div style="margin-bottom:10px;"><span class="col-badge col-${r.col}">${r.label}</span></div>
              <div style="font-size:.7rem;color:var(--txt-dim);text-transform:uppercase;margin-bottom:4px;">Cote</div>
              <div style="font-weight:700;font-size:1rem;margin-bottom:12px;">${fmt(r.cote)}</div>
              <div style="font-size:.7rem;color:var(--txt-dim);text-transform:uppercase;margin-bottom:4px;">Mise</div>
              <div style="font-weight:700;font-size:1.05rem;color:var(--cyan);margin-bottom:12px;">${fmt(r.mise)}</div>
              <div style="font-size:.7rem;color:var(--txt-dim);text-transform:uppercase;margin-bottom:4px;">Gain</div>
              <div style="font-weight:700;font-size:1rem;">${fmt(r.gain)}</div>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:rgba(124,58,237,.1);border-radius:10px;margin-top:8px;">
          <span style="font-size:.82rem;color:var(--txt-dim);text-transform:uppercase;" data-i18n="saisie.budget_total">Budget total</span>
          <strong style="font-size:1.2rem;background:var(--grad-main);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;">${fmt(calc.budget)} ${devise}</strong>
        </div>
      </div>
    `;
  }

  function refreshCalcBlock(card, m) {
    const user = window.CURRENT_USER || { devise: 'XAF' };
    let calc = null, tableaux = null;
    if (cotesComplete(m)) {
      try {
        const cotesSecurisees = CALC.ajusterCotesAvecMarge(m.cotes);
        calc = CALC.calcMises(cotesSecurisees, { constantes: state.constantes || {}, multiplicateur: state.multiplicateur });
        tableaux = CALC.buildTableaux(cotesSecurisees, calc);
      } catch (err) { console.error(err); }
    }
    const oldBlock = card.querySelector('.calc-block');
    const oldHint  = card.querySelector('div[data-i18n="saisie.odds_required"]');
    if (calc) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderCalcBlock(m, calc, tableaux, user.devise).trim();
      const newBlock = wrapper.firstElementChild;
      if (oldBlock) oldBlock.replaceWith(newBlock);
      else if (oldHint) oldHint.replaceWith(newBlock);
      else card.appendChild(newBlock);
      if (window.I18N) window.I18N.apply();
    } else if (oldBlock) {
      const hint = document.createElement('div');
      hint.setAttribute('data-i18n', 'saisie.odds_required');
      hint.style.cssText = 'padding:14px;text-align:center;color:var(--txt-dim);font-size:.85rem;';
      hint.textContent = window.I18N ? window.I18N.t('saisie.odds_required') : 'Renseignez les 3 cotes pour voir le calcul';
      oldBlock.replaceWith(hint);
    }
  }

  function updateFooterBudget(devise) {
    const el = document.getElementById('footer-budget');
    if (!el) return;
    let total = 0;
    state.matchs.forEach(m => {
      if (!cotesComplete(m)) return;
      try {
        const cotesSecurisees = CALC.ajusterCotesAvecMarge(m.cotes);
        const calc = CALC.calcMises(cotesSecurisees, { constantes: state.constantes || {}, multiplicateur: state.multiplicateur });
        total += calc.budget;
      } catch (_) {}
    });
    el.textContent = fmt(total) + ' ' + (devise || 'XAF');
  }

  function bindEvents() {
    const container = document.getElementById('matchs-container');
    if (container) {
      container.replaceWith(container.cloneNode(true));
      const fresh = document.getElementById('matchs-container');
      fresh.addEventListener('input', onMatchInput);
      fresh.addEventListener('click', onMatchClick);
    }

    document.getElementById('btn-add-match')?.addEventListener('click', () => {
      if (!peutSaisirManuellement()) {
        return UI.toast('🔒 Saisie manuelle réservée VIP/Légendaire. Utilisez Suggestions.', 'warn', 5000);
      }
      state.matchs.push(newMatch());
      render();
    });

    document.getElementById('mult-switch')?.addEventListener('click', onMultiplicateurClick);
    document.getElementById('btn-valider')?.addEventListener('click', submitSaisie);
  }

  function onMatchInput(e) {
    const card = e.target.closest('.match-card');
    if (!card) return;
    const m = state.matchs.find(x => x.id === card.dataset.id);
    if (!m) return;
    const field = e.target.dataset.field;
    const cote  = e.target.dataset.cote;
    if (field) m[field] = e.target.value;
    else if (cote) m.cotes[cote] = e.target.value;
    else return;

    refreshCalcBlock(card, m);
    const user = window.CURRENT_USER || { devise: 'XAF' };
    updateFooterBudget(user.devise);

    /* Vérification automatique (debounce 500ms) */
    clearTimeout(m._verifyTimer);
    m._verifyTimer = setTimeout(() => verifierMatch(m.id), 500);
  }

  function onMatchClick(e) {
    const card = e.target.closest('.match-card');
    if (!card) return;
    const m = state.matchs.find(x => x.id === card.dataset.id);
    if (!m) return;
    if (e.target.closest('[data-action="remove"]')) { state.matchs = state.matchs.filter(x => x.id !== m.id); delete state.verif[m.id]; render(); return; }
    const tabBtn = e.target.closest('button[data-tab]');
    if (tabBtn) { m.tableauChoisi = Number(tabBtn.dataset.tab); refreshCalcBlock(card, m); const user = window.CURRENT_USER || { devise: 'XAF' }; updateFooterBudget(user.devise); }
  }

  function onMultiplicateurClick(e) {
    const btn = e.target.closest('button[data-mult]');
    if (!btn) return;
    state.multiplicateur = Number(btn.dataset.mult);
    document.querySelectorAll('#mult-switch button').forEach(b => b.classList.toggle('active', Number(b.dataset.mult) === state.multiplicateur));
    document.querySelectorAll('.match-card').forEach(card => { const m = state.matchs.find(x => x.id === card.dataset.id); if (m) refreshCalcBlock(card, m); });
    const user = window.CURRENT_USER || { devise: 'XAF' };
    updateFooterBudget(user.devise);
  }

  async function submitSaisie() {
    const completes = state.matchs.filter(cotesComplete);
    if (completes.length === 0) return UI.toast('Renseignez au moins un match complet (3 cotes)', 'warn');

    /* ⭐ Vérification automatique de tous les matchs avant validation */
    for (const m of completes) {
      if (!state.verif[m.id]) {
        await verifierMatch(m.id);
      }
    }

    const invalides = completes.filter(m => state.verif[m.id] && state.verif[m.id].valide === false);

    if (invalides.length > 0) {
      const details = invalides.map(m =>
        `• ${m.equipe1 || '?'} vs ${m.equipe2 || '?'} : ${state.verif[m.id].raisons.join(' ; ')}`
      ).join('<br>');
      const ok = await UI.confirm(
        `⚠️ <strong>${invalides.length} match(s) ont des cotes non plausibles :</strong><br><br>` +
        `${details}<br><br>` +
        `Voulez-vous <strong>vraiment</strong> valider ces saisies ?`,
        'Vérification des cotes',
        { html: true, danger: true, confirmText: 'Valider quand même' });
      if (!ok) return;
    }

    const ok = await UI.confirm(`Valider ${completes.length} match(s) et débiter la mise totale ?`, 'Confirmation de saisie');
    if (!ok) return;

    try {
      await UI.withLoader(async () => {
        const date = todayLocal();
        const payload = {
          date, multiplicateur: state.multiplicateur,
          matchs: completes.map(m => {
            const cotesSecurisees = CALC.ajusterCotesAvecMarge(m.cotes);
            return {
              equipe1: m.equipe1 || 'Équipe 1', equipe2: m.equipe2 || 'Équipe 2',
              cotes: { '1': String(cotesSecurisees['1']), 'N': String(cotesSecurisees['N']), '2': String(cotesSecurisees['2']) },
              tableauChoisi: m.tableauChoisi, _external_id: m._external_id || null
            };
          })
        };
        await API.post('/saisies', payload);
        const result = await API.post('/saisies/valider', { date });
        UI.toast(`✅ Saisie validée — ${fmt(result.totalMise)} XAF débités`, 'success', 5000);
        try {
          const { balance } = await API.get('/balance');
          if (window.CURRENT_USER) window.CURRENT_USER.balance = balance;
          const pill = document.getElementById('balance-pill');
          if (pill) pill.querySelector('.value').textContent = window.APP.fmt.money(balance, window.CURRENT_USER?.devise || 'XAF');
        } catch (_) {}
        state.matchs = [];
        state.verif = {};
        render();
        setTimeout(() => Navigation.go('result-budget'), 800);
      });
    } catch (err) { UI.toast('Erreur : ' + (err.data?.error || err.message), 'error', 6000); }
  }

  Navigation.register('saisie', async () => {
    if (!state.constantes) { try { state.constantes = await API.get('/constantes'); } catch (_) { state.constantes = CALC.DEFAULTS; } }

    const pending = sessionStorage.getItem('ia-pending-match');
    if (pending) {
      sessionStorage.removeItem('ia-pending-match');
      try {
        const m = JSON.parse(pending);
        state.matchs.push({
          id: uid(),
          equipe1: m.equipe1 || '',
          equipe2: m.equipe2 || '',
          cotes: { '1': String(m.cotes['1'] || ''), 'N': String(m.cotes['N'] || ''), '2': String(m.cotes['2'] || '') },
          _external_id: m._external_id || null,
          tableauChoisi: 1
        });
      } catch (e) { console.error(e); }
    }

    if (state.matchs.length === 0) {
      if (peutSaisirManuellement()) {
        state.matchs.push(newMatch());
      } else {
        /* Simple/Premium sans match en attente : on affiche l'invite Suggestions */
        state.matchs = [];
      }
    }

    render();
  });
})();