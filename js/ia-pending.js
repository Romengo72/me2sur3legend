// C:\Me\AppMoney\MeParisPortifs\js\ia-pending.js
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => (window.APP && window.APP._esc) ? window.APP._esc(s) : String(s ?? '');

  async function render() {
    const el = document.getElementById('view-ia-pending');
    if (!el) return;

    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement de vos paris en cours…</div>`;

    try {
      const pending = await API.get('/ia/my-pending-matches');
      
      el.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h2 style="margin:0;">⏳ Mes paris en cours</h2>
          <button class="btn ghost sm" onclick="Navigation.go('ia-pending')">🔄 Recharger</button>
        </div>
        
        <div class="glass" style="padding:15px 20px;margin-bottom:20px;background:rgba(34,211,238,0.1);border-left:4px solid var(--cyan);">
          <strong>🤖 Validation Automatique Activée</strong>
          <p style="color:var(--txt-dim);font-size:0.85rem;margin-top:5px;">
            Notre système IA surveille les résultats des matchs en temps réel. 
            Dès qu'un match se termine, vos gains sont automatiquement crédités sur votre solde.
          </p>
        </div>

        ${pending.length === 0 ? `
          <div class="glass empty" style="padding:40px;text-align:center;">
            <div style="font-size:2.5rem;margin-bottom:10px;">✨</div>
            <div style="color:var(--txt-dim);">Aucun match en attente de résultat.</div>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:14px;">
            ${pending.map(m => `
              <div class="ia-validate-card glass" style="padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                  <div style="flex:1;min-width:220px;">
                    <div style="font-size:1.1rem;font-weight:800;margin-bottom:6px;">
                      ⚽ ${esc(m.equipe1)} <span style="color:var(--txt-dim);">vs</span> ${esc(m.equipe2)}
                    </div>
                    <div style="font-size:.82rem;color:var(--txt-dim);">
                      🏆 ${esc(m.league)} · 📅 ${new Date(m.date).toLocaleDateString('fr-FR')}
                    </div>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <span class="ia-cote-mini">W1 ${fmt(m.cotes['1'])}</span>
                    <span class="ia-cote-mini">X ${fmt(m.cotes['N'])}</span>
                    <span class="ia-cote-mini">W2 ${fmt(m.cotes['2'])}</span>
                  </div>
                </div>
                <div style="margin-top:15px;padding:10px;background:rgba(245,158,11,0.1);border-radius:8px;display:flex;align-items:center;gap:10px;">
                  <span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>
                  <span style="font-size:0.85rem;color:var(--orange);font-weight:600;">
                    En attente du résultat officiel...
                  </span>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      `;
    } catch (e) {
      el.innerHTML = `<div class="glass empty">Erreur : ${esc(e.message)}</div>`;
    }
  }

  Navigation.register('ia-pending', render);
})();