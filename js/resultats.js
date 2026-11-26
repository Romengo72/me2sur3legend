// C:\Me\AppMoney\MeParisPortifs\js\resultats.js
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const state = { saisieId: null, saisieDate: null, validation: [], multiplicateur: 1, constantes: null };

  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const labelCol = (col) => col === '1' ? 'W1' : col === 'N' ? 'X' : 'W2';
  const statutClass = (v) => v === 'vert' ? 'vert' : v === 'orange' ? 'orange' : v === 'rouge' ? 'rouge' : 'null';
  const isAdmin = () => window.CURRENT_USER && window.CURRENT_USER.role === 'admin';

  async function loadSaisie() {
    const date = new Date().toISOString().slice(0, 10);
    const saisies = await API.get(`/saisies?date=${date}`);
    if (!Array.isArray(saisies) || saisies.length === 0) {
      state.saisieId = null; state.validation = []; state.multiplicateur = 1; return;
    }
    const derniere = saisies[0];
    state.saisieId = derniere.id;
    state.saisieDate = derniere.date;
    state.multiplicateur = derniere.data.multiplicateur || 1;
    state.validation = derniere.data.VALIDATION || [];
  }

  function computeCalcForMatch(match) {
    try {
      // ⭐ SÉCURITÉ : On ajuste les cotes avant le calcul local
      const cotesSecurisees = CALC.ajusterCotesAvecMarge(match.cotes);
      const calc = CALC.calcMises(cotesSecurisees, { constantes: state.constantes || {}, multiplicateur: state.multiplicateur });
      const tableaux = CALC.buildTableaux(cotesSecurisees, calc);
      return { calc, tableaux };
    } catch (e) { console.error(e); return { calc: null, tableaux: null }; }
  }

  async function render() {
    const el = document.getElementById('view-result-budget');
    if (!el) return;

    if (state.constantes === null) {
      try { state.constantes = await API.get('/constantes'); } catch (_) { state.constantes = CALC.DEFAULTS; }
    }
    await loadSaisie();

    if (!state.validation.length) {
      el.innerHTML = `<div class="glass empty" style="padding:50px;text-align:center;"><div style="font-size:3rem;margin-bottom:14px;">📊</div><div style="font-weight:700;font-size:1.1rem;margin-bottom:6px;">Aucune saisie pour aujourd'hui</div><div style="color:var(--txt-dim);font-size:.9rem;">Rendez-vous dans <strong>Saisie</strong> pour ajouter vos matchs.</div></div>`;
      return;
    }

    let totalBudget = 0, totalGains = 0, nbValides = 0, nbMatchs = 0;
    state.validation.forEach(m => {
      if (!m.valide) return;
      const { calc } = computeCalcForMatch(m);
      if (!calc) return;
      nbMatchs++;
      totalBudget += calc.budget;
      const t = m.tableaux ? m.tableaux[`T${m.tableauChoisi || 1}`] : null;
      if (t && m.statuts) {
        const col = ['1', 'N', '2'].find(c => m.statuts[c]);
        if (col) {
          const cote = Number(m.cotes[col]);
          const row = t.find(x => x.col === col);
          if (row) { totalGains += row.mise * cote; nbValides++; }
        }
      }
    });
    const Ri_total = totalGains - totalBudget;
    const capital = Number(window.CURRENT_USER?.balance || 0);

    const riHtml = isAdmin() ? `<div class="result-stat"><div class="result-stat-label">Ri net</div><div class="result-stat-value ${Ri_total >= 0 ? 'pos' : 'neg'}">${Ri_total >= 0 ? '+' : ''}${fmt(Ri_total)} XAF</div></div>` : '';

    el.innerHTML = `
      <div class="result-stats">
        <div class="result-stat"><div class="result-stat-label">Matchs</div><div class="result-stat-value">${nbMatchs}</div></div>
        <div class="result-stat"><div class="result-stat-label">Budget total</div><div class="result-stat-value">${fmt(totalBudget)} XAF</div></div>
        <div class="result-stat"><div class="result-stat-label">Gains validés</div><div class="result-stat-value pos">${fmt(totalGains)} XAF</div></div>
        ${riHtml}
        <div class="result-stat"><div class="result-stat-label">Solde actuel</div><div class="result-stat-value">${fmt(capital)} XAF</div></div>
      </div>

      <div class="results-list">${state.validation.map((m, i) => renderMatchResult(m, i)).join('')}</div>
      <div class="glass empty" style="padding:14px;text-align:center;margin-top:16px;">
        <small style="color:var(--txt-dim);">${isAdmin() ? '🛡️ Mode admin — cliquez sur les pastilles pour valider le résultat' : '👤 Consultation seule — les statuts sont définis par l\'administrateur'}</small>
      </div>
    `;
    bindEvents();
  }

  function renderMatchResult(match, idx) {
    const { calc, tableaux } = computeCalcForMatch(match);
    if (!calc || !tableaux) return `<div class="glass match-result-block"><div class="mr-header"><strong>Match #${idx + 1}</strong><span class="badge-warn">Cotes incomplètes</span></div></div>`;

    const tableauActif = match.tableauChoisi || 1;
    const T = tableaux[`T${tableauActif}`];
    const statuts = match.statuts || {};
    const admin = isAdmin();

    const colGagnante = ['1', 'N', '2'].find(c => statuts[c]);
    let riInfo = '';
    if (colGagnante) {
      const row = T.find(x => x.col === colGagnante);
      const cote = Number(match.cotes[colGagnante]);
      const gain = row.mise * cote;
      const Ri = gain - calc.budget;
      riInfo = `<div class="ri-banner ${Ri >= 0 ? 'ri-win' : 'ri-lose'}"><span>🎯 Résultat : <strong>${labelCol(colGagnante)}</strong></span><span>Gain : <strong>${fmt(gain)} XAF</strong></span>${admin ? `<span>Ri : <strong>${Ri >= 0 ? '+' : ''}${fmt(Ri)} XAF</strong></span>` : ''}</div>`;
    }

    const tabDescHtml = admin ? `<div class="tab-description">${T.description}</div>` : '';
    const gainMaxHtml = admin ? `<div><span class="bl-label">Gain max</span><span class="bl-value pos">${fmt(T.gainMax)} XAF</span></div><div><span class="bl-label">Couverture</span><span class="bl-value">${T.gagnants.length}/3 ${T.gagnants.length >= 2 ? '✅' : '⚠️'}</span></div>` : '';

    return `
      <div class="glass match-result-block fade-up">
        <div class="mr-header">
          <div class="mr-teams"><strong>${window.APP._esc(match.equipe1 || '?')}</strong><span class="mr-vs">vs</span><strong>${window.APP._esc(match.equipe2 || '?')}</strong></div>
          <div class="mr-badges"><span class="badge-tab">T${tableauActif}</span>${match.valide ? '<span class="badge-valide">🔒 Validée</span>' : '<span class="badge-attente">⏳ Non validée</span>'}</div>
        </div>
        <div class="calc-tabs">
          <div class="tab-switch" data-tab-group data-idx="${idx}">${[1, 2, 3].map(n => `<button type="button" data-tab="${n}" class="${n === tableauActif ? 'active' : ''}">T${n}</button>`).join('')}</div>
          ${tabDescHtml}
        </div>
        <table class="data">
          <thead><tr><th>Colonne</th><th>Cote</th><th>Mise</th><th>Gain</th>${admin ? '<th>Bénéfice</th>' : ''}<th>Statut</th></tr></thead>
          <tbody>
            ${T.map(r => {
              const benef = r.benefice;
              const statut = statuts[r.col];
              const dots = admin ? `<div class="status-dots" data-idx="${idx}" data-col="${r.col}"><span class="status-dot vert ${statut==='vert'?'active':''}" data-statut="vert"></span><span class="status-dot orange ${statut==='orange'?'active':''}" data-statut="orange"></span><span class="status-dot rouge ${statut==='rouge'?'active':''}" data-statut="rouge"></span></div>` : `<span class="status-dot ${statutClass(statut)} ${statut ? 'active' : ''}" style="pointer-events:none;"></span>`;
              const benefHtml = admin ? `<td class="${benef >= 0 ? 'pos' : 'neg'}">${benef >= 0 ? '+' : ''}${fmt(benef)}</td>` : '';
              return `<tr class="${r.gagnant ? 'row-win' : 'row-lose'}"><td><span class="col-badge col-${r.col}">${r.label}</span></td><td>${fmt(r.cote)}</td><td>${fmt(r.mise)}</td><td>${fmt(r.gain)}</td>${benefHtml}<td>${dots}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <div class="budget-line" style="justify-content:center;"><div><span class="bl-label">Budget</span><span class="bl-value">${fmt(calc.budget)} XAF</span></div>${gainMaxHtml}</div>
        ${riInfo}
        ${admin && match.valide ? `<div class="mr-actions"><button class="btn ghost sm" data-action="devalider" data-idx="${idx}">🔄 Dévalider et rembourser</button></div>` : ''}
      </div>`;
  }

  function bindEvents() {
    const root = document.getElementById('view-result-budget');
    if (!root) return;
    root.querySelectorAll('[data-tab-group] button[data-tab]').forEach(btn => { btn.addEventListener('click', async () => { const idx = Number(btn.closest('[data-tab-group]').dataset.idx); const n = Number(btn.dataset.tab); await setTableau(idx, n); }); });
    root.querySelectorAll('.status-dots .status-dot').forEach(dot => { dot.addEventListener('click', async () => { const wrap = dot.closest('.status-dots'); const idx = Number(wrap.dataset.idx); const col = wrap.dataset.col; const statut = dot.dataset.statut; await validerStatut(idx, col, statut); }); });
    root.querySelectorAll('[data-action="devalider"]').forEach(b => { b.addEventListener('click', async () => { const idx = Number(b.dataset.idx); await devalider(idx); }); });
  }

  async function setTableau(idx, num) {
    const m = state.validation[idx];
    if (!m) return;
    if (m.statuts && Object.values(m.statuts).some(s => s)) return UI.toast('Impossible de changer de tableau : une validation existe déjà.', 'warn');
    m.tableauChoisi = num;
    try {
      await API.post('/saisies', { date: state.saisieDate, multiplicateur: state.multiplicateur, matchs: state.validation.map((x, i) => ({ equipe1: x.equipe1, equipe2: x.equipe2, cotes: x.cotes, tableauChoisi: i === idx ? num : (x.tableauChoisi || 1) })) });
      UI.toast(`Tableau T${num} enregistré`, 'success', 2000);
    } catch (e) { UI.toast('Erreur : ' + e.message, 'error'); }
    await render();
  }

  async function validerStatut(idx, col, statut) {
    if (!isAdmin()) return;
    const m = state.validation[idx];
    if (!m || !m.valide) return UI.toast('La mise doit d\'abord être validée (débitée).', 'warn');
    const actuel = m.statuts && m.statuts[col];
    const annuler = actuel === statut;
    const autreCol = ['1', 'N', '2'].find(c => c !== col && m.statuts && m.statuts[c]);
    if (!annuler && autreCol) { const ok = await UI.confirm(`Un statut est déjà validé sur la colonne ${labelCol(autreCol)}. Cela va <strong>ajouter un second gain</strong>. Continuer ?`, '⚠️ Double validation'); if (!ok) return; }
    try {
      UI.showLoader();
      const r = await API.post('/admin/valider-gain', { saisie_id: state.saisieId, idx, statut: annuler ? null : statut });
      UI.hideLoader();
      UI.toast(annuler ? `Statut retiré` : `✅ Gain crédité : +${fmt(r.gain)} XAF`, annuler ? 'info' : 'success', 5000);
      await refreshBalance(); await render();
    } catch (e) { UI.hideLoader(); UI.toast('Erreur : ' + e.message, 'error', 5000); }
  }

  async function devalider(idx) {
    if (!isAdmin()) return;
    const ok = await UI.confirm('Dévalider cette saisie ? La mise sera remboursée.', 'Dévalidation');
    if (!ok) return;
    try {
      UI.showLoader(); await API.del(`/saisies/valider/${state.saisieId}`); UI.hideLoader();
      UI.toast('Saisie dévalidée, mise remboursée.', 'success');
      await refreshBalance(); await render();
    } catch (e) { UI.hideLoader(); UI.toast('Erreur : ' + e.message, 'error'); }
  }

  async function refreshBalance() {
    try {
      const { balance } = await API.get('/balance');
      if (window.CURRENT_USER) window.CURRENT_USER.balance = balance;
      const pill = document.getElementById('balance-pill');
      if (pill) pill.querySelector('.value').textContent = window.APP.fmt.money(balance, window.CURRENT_USER?.devise || 'XAF');
    } catch (_) {}
  }

  Navigation.register('result-budget', async () => { await render(); });
})();