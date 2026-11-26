// C:\Me\AppMoney\MeParisPortifs\js\admin-collect.js
// v6.2.2 — Cohérent avec routes-admin.js (décimales uniquement)
(function () {
  'use strict';

  const state = { open: false, stats: null };

  function open() {
    if (!window.CURRENT_USER || window.CURRENT_USER.role !== 'admin') {
      if (window.UI && UI.toast) UI.toast('Accès réservé à l\'administrateur.', 'warn');
      return;
    }
    state.open = true;
    render();
  }

  function close() {
    state.open = false;
    const el = document.getElementById('collect-overlay');
    if (el) el.remove();
  }

  async function render() {
    let ov = document.getElementById('collect-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'collect-overlay';
      ov.className = 'withdrawal-overlay';
      document.body.appendChild(ov);
    }

    ov.innerHTML = `
      <div class="withdrawal-modal glass" style="max-width:560px;">
        <div class="wd-header">
          <h2>💼 Collecte des décimales</h2>
          <button class="wd-close" onclick="AdminCollect.close()">✕</button>
        </div>

        <p class="wd-info">
          Cette collecte prélève <strong>uniquement la partie décimale</strong> du solde
          de chaque utilisateur (ex: <code>12 345,67 XAF → 0,67 XAF prélevés</code>).
          <br><br>
          <strong style="color:var(--vert);">
            ✅ Le capital entier de chaque utilisateur reste INTACT.
          </strong>
          <br><br>
          <small style="opacity:.85;">
            📅 Cycle automatique : tous les 7 jours<br>
            💡 Montant moyen prélevé : moins de 1 XAF par utilisateur<br>
            📊 Les fonds collectés alimentent le Budget Fonctionnement
          </small>
        </p>

        <div id="collect-stats" style="text-align:center;padding:16px 0;">
          <span class="spinner"></span>
          <span style="margin-left:10px;color:var(--txt-dim);">Chargement des statistiques…</span>
        </div>

        <div class="wd-actions" style="margin-top:20px;">
          <button class="btn ghost" onclick="AdminCollect.close()">Annuler</button>
          <button class="btn" id="btn-collect-confirm" disabled>
            💼 Collecter les décimales
          </button>
        </div>
      </div>`;

    try {
      const s = await API.get('/admin/stats/overview');
      state.stats = s;
      const estimationDecimale = (s.users || 0) * 0.5;

      document.getElementById('collect-stats').innerHTML = `
        <div class="result-stats" style="grid-template-columns:1fr 1fr;gap:12px;text-align:left;margin-bottom:16px;">
          <div class="result-stat">
            <div class="result-stat-label">Utilisateurs actifs</div>
            <div class="result-stat-value">${s.users || 0}</div>
          </div>
          <div class="result-stat">
            <div class="result-stat-label">Budget Fonctionnement actuel</div>
            <div class="result-stat-value">${window.APP.fmt.money(s.bf, 'XAF')}</div>
          </div>
        </div>

        <div class="result-stat" style="text-align:center;padding:18px;background:rgba(34,211,238,.1);border-left:4px solid var(--cyan);">
          <div class="result-stat-label">💰 Estimation des décimales</div>
          <div class="result-stat-value" style="font-size:1.5rem;color:var(--cyan);">
            ~ ${window.APP.fmt.money(estimationDecimale, 'XAF')}
          </div>
          <div style="color:var(--txt-dim);font-size:.8rem;margin-top:6px;">
            Estimation basée sur ~0,50 XAF par utilisateur
          </div>
        </div>

        <div style="margin-top:16px;padding:12px 16px;background:rgba(16,185,129,.1);border-radius:10px;border-left:3px solid var(--vert);">
          <div style="font-size:.82rem;color:var(--txt-dim);line-height:1.5;">
            <strong style="color:var(--vert);">✅ Aucun risque pour les utilisateurs</strong><br>
            Le capital entier (partie avant la virgule) reste sur le compte.
            Seul le reliquat centime est prélevé.
          </div>
        </div>`;

      const btn = document.getElementById('btn-collect-confirm');
      if (btn) {
        btn.disabled = false;
        btn.addEventListener('click', confirmCollect);
      }
    } catch (e) {
      console.error('[AdminCollect] Erreur chargement stats :', e);
      document.getElementById('collect-stats').innerHTML =
        `<p style="color:var(--rouge);">Erreur : ${e.message}</p>`;
    }
  }

  async function confirmCollect() {
    const ok = await UI.confirm(
      `Confirmez-vous la collecte des <strong>parties décimales</strong> ?<br><br>` +
      `Seront prélevés : <strong>uniquement les centimes</strong> (ex: 0,67 XAF sur 12 345,67 XAF).<br><br>` +
      `<strong style="color:var(--vert);">Le capital entier des utilisateurs reste intact.</strong>`,
      '💼 Collecte des décimales',
      { html: true });
    if (!ok) return;

    try {
      UI.showLoader();
      const r = await API.post('/admin/collect-funds', {});
      UI.hideLoader();

      UI.toast(
        `✅ ${r.collected.toFixed(2)} XAF collectés sur ${r.nbUsers} utilisateur(s)`,
        'success', 7000);

      try {
        const { balance } = await API.get('/balance');
        if (window.CURRENT_USER) window.CURRENT_USER.balance = balance;
        const pill = document.getElementById('balance-pill');
        if (pill) {
          pill.querySelector('.value').textContent =
            window.APP.fmt.money(balance, window.CURRENT_USER?.devise || 'XAF');
        }
      } catch (_) {}

      close();
    } catch (e) {
      UI.hideLoader();
      console.error('[AdminCollect] Erreur :', e);
      UI.toast('❌ ' + (e.data?.error || e.message), 'error', 6000);
    }
  }

  window.AdminCollect = { open, close };
})();