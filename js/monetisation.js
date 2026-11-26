// C:\Me\AppMoney\MeParisPortifs\js\monetisation.js
// v6.2.8 — prestige → legendaire, /public/plans, fallback name/nom
(function () {
  'use strict';
  if (typeof Navigation === 'undefined') return;

  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const esc = (s) => (window.APP && window.APP._esc) ? window.APP._esc(s) : String(s ?? '');

  /* =============================================================== */
  /* 1. CLASSEMENT                                                   */
  /* =============================================================== */
  Navigation.register('leaderboard', async () => {
    const el = document.getElementById('view-leaderboard');
    if (!el) return;
    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;
    try {
      const list = await API.get('/public/leaderboard');
      if (!list.length) {
        el.innerHTML = '<div class="glass empty">Classement en cours de constitution.</div>';
        return;
      }
      el.innerHTML = `
        <h2 style="margin-bottom:20px;">🏆 Top 10 des capitalistes</h2>
        <div class="glass" style="padding:20px;overflow-x:auto;">
          <table class="data" style="width:100%;">
            <thead><tr><th>Rang</th><th>Utilisateur</th><th>Solde (XAF)</th></tr></thead>
            <tbody>
              ${list.map(u => `
                <tr>
                  <td><strong>#${u.rank}</strong></td>
                  <td><code>${esc(u.email)}</code></td>
                  <td style="color:var(--vert);font-weight:800;">${fmt(u.balance)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (e) { el.innerHTML = `<div class="glass empty">Erreur : ${esc(e.message)}</div>`; }
  });

  /* =============================================================== */
  /* 2. ACTUALITÉS                                                   */
  /* =============================================================== */
  Navigation.register('news', async () => {
    const el = document.getElementById('view-news');
    if (!el) return;
    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;
    try {
      const list = await API.get('/public/news');
      if (!list.length) {
        el.innerHTML = '<div class="glass empty">Aucune actualité pour le moment.</div>';
        return;
      }
      el.innerHTML = `
        <h2 style="margin-bottom:20px;">📰 Actualités</h2>
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${list.map(n => `
            <div class="glass" style="padding:24px;border-left:4px solid var(--cyan);border-radius:12px;">
              <div style="font-size:.8rem;color:var(--txt-dim);margin-bottom:10px;">📅 ${new Date(n.date || n.published_at).toLocaleDateString('fr-FR')}</div>
              <h3 style="margin-bottom:10px;">${esc(n.titre || n.title)}</h3>
              <p style="color:var(--txt-dim);line-height:1.6;">${esc(n.contenu || n.excerpt || '')}</p>
            </div>
          `).join('')}
        </div>`;
    } catch (e) { el.innerHTML = `<div class="glass empty">Erreur : ${esc(e.message)}</div>`; }
  });

  /* =============================================================== */
  /* 3. PARRAINAGE                                                   */
  /* =============================================================== */
  Navigation.register('referral', async () => {
    const el = document.getElementById('view-referral');
    if (!el) return;
    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;

    try {
      const profile = await API.get('/user/profile');
      const link = `${location.origin}/login?ref=${profile.referral_code}`;

      el.innerHTML = `
        <h2 style="margin-bottom:20px;">🎁 Parrainage</h2>
        <div class="glass" style="padding:40px;text-align:center;background:linear-gradient(135deg,rgba(124,58,237,.1),rgba(34,211,238,.05));border:2px dashed rgba(124,58,237,.4);">
          <p style="color:var(--txt-dim);margin-bottom:20px;font-size:1.05rem;">Invitez vos amis et gagnez <strong>250 XAF</strong> pour chaque inscription validée.</p>
          <div style="font-size:2.5rem;font-weight:900;color:var(--cyan);letter-spacing:0.1em;margin-bottom:24px;">${esc(profile.referral_code)}</div>

          <div style="display:flex;justify-content:center;">
            <button class="btn btn-lg" id="btn-share-referral" style="background:var(--grad-main);padding:12px 32px;font-size:1.05rem;display:flex;align-items:center;gap:10px;">
              <span style="font-size:1.2rem;">📤</span> Partager l'invitation
            </button>
          </div>
        </div>

        <div class="stats-grid" style="margin-top:24px;">
          <div class="stat-card"><div class="stat-label">Filleuls</div><div class="stat-value">${profile.referralCount}</div></div>
          <div class="stat-card"><div class="stat-label">Bonus gagnés</div><div class="stat-value" style="color:var(--vert);">${fmt(profile.referralCount * 250)} XAF</div></div>
        </div>`;

      document.getElementById('btn-share-referral')?.addEventListener('click', async () => {
        const message = `Rejoignez-moi sur Me2/3Legend et bénéficiez de mes conseils en paris sportifs !\n\nMon code parrain : ${profile.referral_code}\nInscrivez-vous ici : ${link}`;

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;

        if (isMobile && navigator.share) {
          try {
            await navigator.share({ title: 'Invitation Me2/3Legend', text: message, url: link });
            UI.toast('✅ Merci pour le partage !', 'success');
          } catch (err) {
            if (err.name !== 'AbortError') {
              showDesktopShareModal(profile.referral_code, link, message);
            }
          }
        } else {
          showDesktopShareModal(profile.referral_code, link, message);
        }
      });

    } catch (e) {
      el.innerHTML = `<div class="glass empty">Erreur : ${esc(e.message)}</div>`;
    }
  });

  function showDesktopShareModal(code, link, message) {
    let ov = document.getElementById('share-modal');
    if (ov) ov.remove();

    ov = document.createElement('div');
    ov.id = 'share-modal';
    ov.className = 'withdrawal-overlay';

    const closeModal = () => { if (ov) ov.remove(); };

    ov.innerHTML = `
      <div class="withdrawal-modal glass" style="max-width:500px;">
        <div class="wd-header">
          <h2>✉️ Invitation</h2>
          <button class="wd-close" id="btn-close-share">✕</button>
        </div>

        <p class="wd-info">
          Voici le message prêt à être envoyé. Choisissez le canal (le code parrain <strong>${esc(code)}</strong> et le lien sont inclus).
        </p>

        <div class="wd-field">
          <label>Aperçu du message</label>
          <textarea class="input" id="share-text" rows="5" readonly style="background:rgba(10,10,25,.8); color:#fff; font-size:0.9rem; resize:none;">${esc(message)}</textarea>
        </div>

        <div class="wd-actions" style="margin-top:20px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <button class="btn ghost" id="btn-wa-share" style="color:var(--vert); border-color:var(--vert);">💬 WhatsApp</button>
          <button class="btn ghost" id="btn-mail-share" style="color:var(--cyan); border-color:var(--cyan);">✉️ Email</button>
        </div>
      </div>
    `;

    document.body.appendChild(ov);

    document.getElementById('btn-close-share').addEventListener('click', closeModal);

    document.getElementById('btn-wa-share').addEventListener('click', () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
      closeModal();
    });

    document.getElementById('btn-mail-share').addEventListener('click', () => {
      const subject = encodeURIComponent('Invitation à rejoindre Me2/3Legend');
      const body = encodeURIComponent(message);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      closeModal();
    });
  }

  /* =============================================================== */
  /* 4. ABONNEMENT                                                   */
  /* =============================================================== */
  Navigation.register('subscription', async () => {
    const el = document.getElementById('view-subscription');
    if (!el) return;
    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement des formules…</div>`;

    try {
      const plans = await API.get('/public/plans');
      const userCat = window.CURRENT_USER?.category || 'free';

      el.innerHTML = `
        <h2 style="margin-bottom:20px;">💎 Choisissez votre formule</h2>
        <p style="color:var(--txt-dim);margin-bottom:24px;">Payez votre abonnement par Mobile Money et accédez immédiatement aux fonctionnalités exclusives.</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;">
          ${plans.map(p => {
            const isCurrent = userCat === p.code;
            const color = p.couleur === 'violet' ? '#7c3aed' : p.couleur === 'or' ? '#f59e0b' : p.couleur === 'cyan' ? '#22d3ee' : '#94a3b8';
            const icon = p.code === 'legendaire' ? '💎' : p.code === 'vip' ? '👑' : p.code === 'premium' ? '⭐' : '👤';
            const nom = p.name || p.nom || p.code;

            let features = [];
            try {
              features = typeof p.features === 'string' ? JSON.parse(p.features) : (p.features || []);
            } catch(e) { features = []; }

            return `
              <div class="glass" style="padding:30px 20px;border:${isCurrent ? '2px solid '+color : '1px solid var(--glass-brd)'};border-radius:20px;text-align:center;position:relative;">
                ${isCurrent ? `<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:${color};color:#000;padding:4px 16px;border-radius:999px;font-size:.7rem;font-weight:900;">VOTRE FORMULE</div>` : ''}
                <div style="font-size:3rem;margin-bottom:10px;">${icon}</div>
                <div style="font-size:1.3rem;font-weight:900;color:${color};margin-bottom:6px;">${esc(nom)}</div>
                <div style="font-size:1.8rem;font-weight:800;color:var(--txt);margin-bottom:20px;">${fmt(p.price_monthly || p.prix_mensuel)} <span style="font-size:.9rem;color:var(--txt-dim);font-weight:400;">XAF/mois</span></div>
                <ul style="text-align:left;font-size:.88rem;color:var(--txt-dim);margin-bottom:24px;list-style:none;padding-left:0;">
                  ${(features || []).map(f => `<li style="margin-bottom:8px;display:flex;gap:8px;"><span style="color:${color};">✓</span> <span>${esc(f)}</span></li>`).join('')}
                </ul>
                ${isCurrent
                  ? `<button class="btn" disabled style="width:100%;background:rgba(255,255,255,0.1);color:var(--txt-dim);">✓ Déjà abonné</button>`
                  : Number(p.price_monthly || p.prix_mensuel) === 0
                    ? `<a href="/login?tab=register" class="btn" style="width:100%;">S'inscrire gratuitement</a>`
                    : `<button class="btn btn-subscribe" data-code="${p.code}" data-name="${esc(nom)}" style="width:100%;background:linear-gradient(135deg,${color},#4f46e5);color:#fff;">Payer ${fmt(p.price_monthly || p.prix_mensuel)} XAF</button>`}
              </div>
            `;
          }).join('')}
        </div>
      `;

      el.querySelectorAll('.btn-subscribe').forEach(b => {
        b.addEventListener('click', () => openCheckoutModal(b.dataset.code, b.dataset.name));
      });

    } catch (e) {
      el.innerHTML = `<div class="glass empty">Erreur de chargement : ${esc(e.message)}</div>`;
    }
  });

  function openCheckoutModal(planCode, planName) {
    const overlay = document.createElement('div');
    overlay.className = 'withdrawal-overlay';
    overlay.id = 'checkout-modal';

    overlay.innerHTML = `
      <div class="withdrawal-modal glass" style="max-width:460px;">
        <div class="wd-header">
          <h2>💳 Paiement Abonnement</h2>
          <button class="wd-close" onclick="document.getElementById('checkout-modal').remove()">✕</button>
        </div>

        <p class="wd-info">Vous êtes sur le point de souscrire à la formule <strong>${esc(planName)}</strong>.</p>

        <div class="wd-field">
          <label>Nom complet</label>
          <input type="text" class="input" id="co-name" placeholder="Votre nom">
        </div>
        <div class="wd-field">
          <label>Email</label>
          <input type="email" class="input" id="co-email" placeholder="votre@email.com">
        </div>
        <div class="wd-field">
          <label>Mot de passe (pour sécuriser votre compte)</label>
          <input type="password" class="input" id="co-password" placeholder="Minimum 6 caractères">
        </div>

        <div class="wd-actions" style="margin-top:20px;">
          <button class="btn ghost" onclick="document.getElementById('checkout-modal').remove()">Annuler</button>
          <button class="btn" id="co-submit">💳 Payer et activer</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('co-submit').addEventListener('click', async () => {
      const email = document.getElementById('co-email').value.trim();
      const password = document.getElementById('co-password').value;
      const fullName = document.getElementById('co-name').value.trim();

      if (!email || !password || password.length < 6) {
        return UI.toast('Email et mot de passe (6+) requis', 'warn');
      }

      const btn = document.getElementById('co-submit');
      btn.disabled = true;
      btn.textContent = 'Redirection…';

      try {
        const r = await API.post('/payment/subscribe', { email, password, plan_code: planCode, fullName });
        if (r.payment_url) {
          sessionStorage.setItem('payment-redirect-url', r.payment_url);
          sessionStorage.setItem('payment-transaction-id', r.transaction_id || '');
          window.location.href = '/payment-transition';
        } else {
          throw new Error('Lien de paiement introuvable');
        }
      } catch (e) {
        UI.toast('❌ ' + (e.data?.error || e.message), 'error', 6000);
        btn.disabled = false;
        btn.textContent = '💳 Payer et activer';
      }
    });
  }

  /* =============================================================== */
  /* 5. STATISTIQUES                                                 */
  /* =============================================================== */
  Navigation.register('stat', async () => {
    const el = document.getElementById('view-stat');
    if (!el) return;
    el.innerHTML = `<div class="glass" style="padding:32px;text-align:center;"><span class="spinner"></span> Chargement…</div>`;
    try {
      const data = await API.get('/user/totals');
      el.innerHTML = `
        <h2 style="margin-bottom:20px;">📈 Statistiques</h2>
        <div class="stats-grid" style="margin-bottom:20px;">
          <div class="stat-card"><div class="stat-label">Total misé</div><div class="stat-value">${fmt(data.totalMises)} XAF</div></div>
          <div class="stat-card"><div class="stat-label">Total gagné</div><div class="stat-value" style="color:var(--vert);">${fmt(data.totalGains)} XAF</div></div>
          <div class="stat-card"><div class="stat-label">Bénéfice net</div><div class="stat-value ${data.benefice >= 0 ? 'pos' : 'neg'}">${data.benefice >= 0 ? '+' : ''}${fmt(data.benefice)} XAF</div></div>
        </div>
        <div class="glass" style="padding:20px;text-align:center;">
          <p style="color:var(--txt-dim);">Rendez-vous dans l'onglet <strong>Historique</strong> pour voir le détail de vos paris.</p>
        </div>`;
    } catch (e) { el.innerHTML = `<div class="glass empty">Erreur : ${esc(e.message)}</div>`; }
  });
})();