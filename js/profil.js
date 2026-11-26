// C:\Me\AppMoney\MeParisPortifs\js\profil.js
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const CATEGORIES_META = {
    admin:      { label: 'Administrateur', color: '#f59e0b', icon: '🛡️', prix: 0,     description: 'Accès total.' },
    free:       { label: 'Simple',         color: '#94a3b8', icon: '👤', prix: 0,     description: 'Découverte de la plateforme.' },
    premium:    { label: 'Premium',        color: '#7c3aed', icon: '⭐', prix: 5000,  description: '+2% bonus dépôt, -1% frais retrait.' },
    vip:        { label: 'VIP',            color: '#f59e0b', icon: '👑', prix: 15000, description: '+5% bonus, 0% frais retrait, IA illimitée.' },
    legendaire: { label: 'Légendaire',     color: '#22d3ee', icon: '💎', prix: 25000, description: '+10% bonus, 0% frais, Validation auto IA.' }
  };

  const esc = (s) => (window.APP && window.APP._esc) ? window.APP._esc(s) : String(s ?? '');
  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });

  async function render() {
    const el = document.getElementById('view-profil');
    if (!el) return;

    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;

    let profile = null;
    try { 
      profile = await API.get('/user/profile'); 
    } catch (e) { 
      el.innerHTML = `<div class="glass empty">Erreur : ${esc(e.message)}</div>`; 
      return; 
    }

    const isAdmin = profile.role === 'admin';
    const cat = isAdmin ? CATEGORIES_META.admin : (CATEGORIES_META[profile.category] || CATEGORIES_META.free);

    // ⚠️ LE BOUTON SUPPRIMER EST ICI, INTÉGRÉ DANS LE HTML
    el.innerHTML = `
      <div class="profil-header glass" style="margin-bottom:20px;">
        <div class="profil-id">
          <div class="profil-avatar" style="background:linear-gradient(135deg,${cat.color},#22d3ee);">${cat.icon}</div>
          <div>
            <div class="profil-name">${esc(profile.full_name || profile.email)}</div>
            <div class="profil-userid">🆔 <code>${esc(profile.user_id || '—')}</code></div>
          </div>
        </div>
        <div class="profil-cat" style="background:${cat.color}22;border-color:${cat.color};">
          <span style="color:${cat.color};font-size:1.6rem;">${cat.icon}</span>
          <div>
            <div style="color:${cat.color};font-weight:800;font-size:1.1rem;">${cat.label}</div>
            <div style="color:var(--txt-dim);font-size:.75rem;">${cat.description}</div>
          </div>
        </div>
      </div>

      <div class="result-stats" style="margin-bottom:20px;">
        <div class="result-stat"><div class="result-stat-label">Solde</div><div class="result-stat-value">${fmt(profile.balance)} XAF</div></div>
        <div class="result-stat"><div class="result-stat-label">Filleuls</div><div class="result-stat-value">${profile.referralCount || 0}</div></div>
      </div>

      ${isAdmin ? `<div class="glass" style="padding:22px;margin-bottom:20px;background:rgba(245,158,11,.1);border-left:4px solid #f59e0b;">
        <strong>🛡️ Mode Administrateur</strong> : accès total sans restriction.
      </div>` : `
        <h3 style="margin-bottom:14px;">💎 Améliorer mon statut</h3>
        <div class="profil-cats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;">
          ${['premium', 'vip', 'legendaire'].map(key => {
            const c = CATEGORIES_META[key];
            const isCurrent = profile.category === key;
            return `
              <div class="profil-cat-card ${isCurrent ? 'current' : ''}"
                   style="border-color:${isCurrent ? c.color : 'var(--glass-brd)'};text-align:center;padding:20px;">
                <div style="font-size:2rem;margin-bottom:10px;">${c.icon}</div>
                <div style="color:${c.color};font-weight:800;font-size:1.2rem;margin-bottom:8px;">${c.label}</div>
                <div style="font-size:0.85rem;color:var(--txt-dim);text-align:left;margin-bottom:15px;min-height:40px;">${c.description}</div>
                <div style="font-weight:800;color:var(--cyan);margin-bottom:10px;">${fmt(c.prix, 0)} XAF/mois</div>
                ${isCurrent
                  ? `<button class="btn ghost sm" disabled style="width:100%;">✓ Actuel</button>`
                  : `<button class="btn sm profil-upgrade-btn" data-cat="${key}" style="width:100%;background:${c.color};">Choisir</button>`}
              </div>
            `;
          }).join('')}
        </div>
      `}

      <!-- ⚠️ ZONE DE DANGER (SUPPRESSION DE COMPTE) -->
      ${!isAdmin ? `
        <div class="glass" style="padding:20px; margin-top:30px; border-left:4px solid var(--rouge); background:rgba(239,68,68,.05);">
          <h3 style="color:var(--rouge); margin-bottom:10px;">⚠️ Zone de danger</h3>
          <p style="font-size:0.85rem; color:var(--txt-dim); margin-bottom:15px;">
            La suppression de votre compte entraînera la perte définitive de votre solde et de votre historique. Un administrateur traitera votre demande sous 24h.
          </p>
          <button class="btn" id="btn-request-deletion" style="background:rgba(239,68,68,.2); color:var(--rouge); border:1px solid var(--rouge);">
            🗑️ Demander la suppression de mon compte
          </button>
        </div>
      ` : ''}
    `;

    // Écouteurs d'événements
    el.querySelectorAll('.profil-upgrade-btn').forEach(b => {
      b.addEventListener('click', () => upgrade(b.dataset.cat));
    });

    document.getElementById('btn-request-deletion')?.addEventListener('click', async () => {
      const ok = await UI.confirm(
        "Voulez-vous vraiment demander la suppression de votre compte ? Un administrateur examinera votre demande.",
        "⚠️ Suppression de compte", { danger: true }
      );
      if (!ok) return;
      try {
        await UI.withLoader(async () => {
          await API.post('/user/request-deletion', {});
        });
        UI.toast('Demande transmise à l\'administrateur.', 'success');
        document.getElementById('btn-request-deletion').disabled = true;
        document.getElementById('btn-request-deletion').textContent = 'Demande en cours d\'examen';
      } catch (e) {
        UI.toast('Erreur : ' + (e.data?.error || e.message), 'error');
      }
    });
  }

  async function upgrade(category) {
    const label = CATEGORIES_META[category]?.label;
    const prix = CATEGORIES_META[category]?.prix || 0;
    const ok = await UI.confirm(
      `Confirmer l'upgrade vers <strong>${label}</strong> ?<br><br>` +
      `<strong>${prix.toLocaleString('fr-FR')} XAF</strong> seront débités.`,
      '💎 Upgrade', { html: true });
    if (!ok) return;

    try {
      let r;
      await UI.withLoader(async () => { r = await API.post('/user/upgrade', { category }); });

      if (r.user && window.CURRENT_USER) {
        window.CURRENT_USER.category = r.user.category;
        window.CURRENT_USER.balance  = Number(r.user.balance);
      } else if (window.CURRENT_USER) {
        window.CURRENT_USER.category = category;
        window.CURRENT_USER.balance  = r.newBalance;
      }

      const pill = document.getElementById('balance-pill');
      if (pill && r.newBalance !== undefined) {
        const v = pill.querySelector('.value');
        if (v) v.textContent = window.APP.fmt.money(r.newBalance, window.CURRENT_USER?.devise || 'XAF');
      }

      UI.toast(`✅ Bienvenue dans ${label} !`, 'success', 5000);
      await render();
    } catch (e) {
      UI.toast('❌ ' + (e.data?.error || e.message), 'error', 6000);
    }
  }

  Navigation.register('profil', render);
})();