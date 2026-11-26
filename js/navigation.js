// C:\Me\AppMoney\MeParisPortifs\js\navigation.js
// v6.2.9 — Double vérification VIP, ia-pending pour tous, messages clairs
window.Navigation = (() => {
  'use strict';

  const views = {};
  const titles = {
    'saisie':        ['Saisie', 'Calculez vos mises optimales'],
    'result-budget': ['Résultats', 'Suivi des matchs et budgets'],
    'history':       ['Historique', 'Toutes vos saisies passées'],
    'stat':          ['Statistiques', 'Performance et rentabilité'],
    'suggestion':    ['Suggestions', 'Recherche de matchs'],
    'ia-vip':        ['Matchs VIP', 'Cotes optimisées par IA'],
    'ia-pending':    ['Paris en attente', 'Suivi de vos gains en cours'],
    'leaderboard':   ['Classement', 'Top 10 utilisateurs'],
    'subscription':  ['Abonnement', 'Votre formule Me2/3Legend'],
    'referral':      ['Parrainage', 'Invitez et gagnez'],
    'news':          ['Actualités', 'Nouvelles de la plateforme'],
    'profil':        ['Mon profil', 'Identifiant, catégorie et bonus'],
    'admin':         ['Administration', 'Gestion de la plateforme']
  };

  /* ⭐ v6.2.9 : permissions par vue (null = accessible à tous) */
  const viewPermissions = {
    'saisie':        'can_saisir',
    'result-budget': 'can_voir_resultats',
    'history':       'can_voir_historique',
    'stat':          'can_voir_stats',
    'referral':      'can_parrainer',
    'news':          'can_voir_news',
    'ia-vip':        'can_use_vip_ia'
  };

  /* Vérification des dépendances (utile pour debug) */
  function checkDependencies() {
    const deps = {
      APP:  typeof window.APP  !== 'undefined',
      CALC: typeof window.CALC !== 'undefined',
      API:  typeof window.API  !== 'undefined',
      UI:   typeof window.UI   !== 'undefined'
    };
    const missing = Object.keys(deps).filter(k => !deps[k]);
    return { ok: missing.length === 0, missing };
  }

  function register(name, renderFn) {
    if (typeof renderFn === 'function') views[name] = renderFn;
  }

  function categoryBadge(cat, role) {
    if (role === 'admin') {
      return '<span style="background:linear-gradient(135deg,#f59e0b,#ef4444,#7c3aed);color:#fff;padding:3px 12px;border-radius:999px;font-size:.68rem;font-weight:800;box-shadow:0 0 12px rgba(245,158,11,.5);">🛡️ ADMIN</span>';
    }
    const map = {
      free:       '<span style="background:#475569;color:#fff;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:700;">👤 SIMPLE</span>',
      premium:    '<span style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:700;">⭐ PREMIUM</span>',
      vip:        '<span style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:700;">👑 VIP</span>',
      legendaire: '<span style="background:linear-gradient(135deg,#22d3ee,#7c3aed);color:#fff;padding:3px 10px;border-radius:999px;font-size:.68rem;font-weight:700;">💎 LÉGENDAIRE</span>'
    };
    return map[cat] || map.free;
  }

  function applyRoleUI(user, perms) {
    const isAdmin = user.role === 'admin';
    perms = perms || {};

    /* Affichage des éléments réservés */
    document.querySelectorAll('.user-only').forEach(el => {
      el.style.display = isAdmin ? 'none' : 'inline-flex';
    });
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? 'inline-flex' : 'none';
    });

    /* Lien admin (dans le menu) */
    if (isAdmin) {
      const navAdmin = document.getElementById('nav-admin');
      if (navAdmin) navAdmin.hidden = false;
    }

    const nav = document.getElementById('main-nav');
    if (nav) {
      /* Masquer/afficher les liens selon permission */
      const checkPerm = (viewName, permKey) => {
        const link = nav.querySelector(`[data-view="${viewName}"]`);
        if (link) link.style.display = (isAdmin || perms[permKey]) ? 'flex' : 'none';
      };

      checkPerm('saisie', 'can_saisir');
      checkPerm('history', 'can_voir_historique');
      checkPerm('stat', 'can_voir_stats');
      checkPerm('referral', 'can_parrainer');
      checkPerm('news', 'can_voir_news');
      checkPerm('result-budget', 'can_voir_resultats');

      /* Boutons Dépôt / Retrait */
      const btnDeposit = document.getElementById('btn-deposit');
      if (btnDeposit) btnDeposit.style.display = (!isAdmin && perms.can_deposer) ? 'inline-flex' : 'none';

      const btnWithdraw = document.getElementById('btn-withdraw');
      if (btnWithdraw) btnWithdraw.style.display = (!isAdmin && perms.can_retirer) ? 'inline-flex' : 'none';

      /* ⭐ v6.2.9 : lien ia-vip — double vérification permission ET catégorie */
      const categorieAutorisee = ['vip', 'legendaire'].includes(user.category);
      const peutVipIA = isAdmin || (perms.can_use_vip_ia && categorieAutorisee);

      if (peutVipIA && !nav.querySelector('[data-view="ia-vip"]')) {
        const a = document.createElement('a');
        a.dataset.view = 'ia-vip';
        a.innerHTML = '<span class="nav-ico">👑</span> Matchs VIP IA';
        const ref = nav.querySelector('[data-view="profil"]');
        if (ref) nav.insertBefore(a, ref);
        else nav.appendChild(a);
        a.addEventListener('click', e => { e.preventDefault(); go('ia-vip'); });
      } else if (!peutVipIA) {
        /* Masquer le lien s'il existe mais que l'utilisateur n'y a plus droit */
        const existing = nav.querySelector('[data-view="ia-vip"]');
        if (existing) existing.style.display = 'none';
      }

      /* ⭐ v6.2.9 : lien ia-pending — visible pour tous (suivi) */
      if (!nav.querySelector('[data-view="ia-pending"]')) {
        const a = document.createElement('a');
        a.dataset.view = 'ia-pending';
        a.innerHTML = '<span class="nav-ico">⏳</span> Paris en attente';
        const ref = nav.querySelector('[data-view="profil"]');
        if (ref) nav.insertBefore(a, ref);
        else nav.appendChild(a);
        a.addEventListener('click', e => { e.preventDefault(); go('ia-pending'); });
      }
    }

    /* Libellé du solde (admin vs user) */
    const balanceLabel = document.getElementById('balance-label');
    if (balanceLabel) balanceLabel.textContent = isAdmin ? 'Budget Fonctionnement' : 'Mon solde';

    /* Badge d'identité dans le topbar */
    const topRight = document.querySelector('.top-right');
    if (topRight && user.user_id) {
      const oldId = document.getElementById('user-identity-badge');
      if (oldId) oldId.remove();

      const badge = document.createElement('div');
      badge.id = 'user-identity-badge';
      badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 14px;border-radius:var(--radius);background:rgba(10,10,25,.55);border:1px solid var(--glass-brd);';
      badge.innerHTML = `<code style="font-size:.72rem;color:var(--cyan);font-weight:700;">${window.APP._esc(user.user_id)}</code> ${categoryBadge(user.category, user.role)}`;

      const pill = document.getElementById('balance-pill');
      if (pill && pill.parentNode === topRight) pill.insertAdjacentElement('afterend', badge);
      else topRight.prepend(badge);
    }
  }

  async function go(name) {
    if (!views[name]) {
      const msg = `Le module "${name}" n'est pas chargé. Vérifiez que le fichier JS correspondant est inclus dans app.html.`;
      console.error('[Navigation]', msg);
      if (window.UI && UI.toast) UI.toast(msg, 'error');
      return;
    }

    /* Vérification permission */
    const requiredPerm = viewPermissions[name];
    const isAdmin = window.CURRENT_USER && window.CURRENT_USER.role === 'admin';
    const hasPerm = isAdmin || (window.CURRENT_PERMS && window.CURRENT_PERMS[requiredPerm]);

    if (requiredPerm && !hasPerm) {
      if (window.UI && UI.toast) UI.toast("⛔ Vous n'avez pas la permission d'accéder à cette page.", 'error');
      if (name !== 'profil') go('profil');
      return;
    }

    /* Mise à jour visuelle */
    document.querySelectorAll('#main-nav a').forEach(a => {
      a.classList.toggle('active', a.dataset.view === name);
    });

    const [title, sub] = titles[name] || [name, ''];
    if (document.getElementById('view-title')) document.getElementById('view-title').textContent = title;
    if (document.getElementById('view-subtitle')) document.getElementById('view-subtitle').textContent = sub;

    const container = document.getElementById('views');
    container.innerHTML = `<section id="view-${name}" class="view"></section>`;

    try {
      if (window.UI && UI.showLoader) UI.showLoader();
      await views[name]();
      if (window.I18N) window.I18N.apply();
    } catch (e) {
      console.error(`[Navigation] Erreur vue "${name}" :`, e);
      container.innerHTML = `<div class="glass empty" style="color:var(--rouge); padding: 40px; text-align: center;">
        Erreur : ${window.APP._esc(e.message)}
      </div>`;
    } finally {
      if (window.UI && UI.hideLoader) UI.hideLoader();
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    /* Bind des liens du menu */
    document.querySelectorAll('#main-nav a').forEach(a => {
      a.addEventListener('click', (e) => { e.preventDefault(); go(a.dataset.view); });
    });

    /* Bouton déconnexion */
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          const ok = window.UI && UI.confirm
            ? await UI.confirm('Voulez-vous vraiment vous déconnecter ?')
            : window.confirm('Déconnexion ?');
          if (!ok) return;
        } catch (err) {
          console.warn('Erreur UI lors de la déco, on force.');
        }

        try { await API.logout(); } catch (_) {}

        sessionStorage.clear();
        localStorage.removeItem('ia-pending-match');

        window.location.href = '/login';
      });
    }

    /* Chargement du profil + permissions */
    try {
      const { user, permissions } = await API.me();
      window.CURRENT_USER = user;
      window.CURRENT_PERMS = permissions || {};

      /* Nettoyage si un match externe a été mis en session par un non-VIP */
      const pendingMatch = sessionStorage.getItem('ia-pending-match');
      if (pendingMatch) {
        try {
          const m = JSON.parse(pendingMatch);
          if (m._external_id && !['vip', 'legendaire'].includes(user.category) && user.role !== 'admin') {
            sessionStorage.removeItem('ia-pending-match');
          }
        } catch (_) {
          sessionStorage.removeItem('ia-pending-match');
        }
      }

      /* Affichage du solde */
      const pill = document.getElementById('balance-pill');
      if (pill) {
        pill.querySelector('.value').textContent =
          window.APP.fmt.money(user.balance, user.devise || 'XAF');
      }

      applyRoleUI(user, window.CURRENT_PERMS);

      /* Vue d'accueil selon permission */
      if (window.CURRENT_PERMS.can_saisir || user.role === 'admin') {
        go('saisie');
      } else {
        go('profil');
      }

    } catch (e) {
      console.error('[Navigation] Échec /me :', e);
      if (e.status === 401) {
        window.location.href = '/login';
        return;
      }
      const viewsEl = document.getElementById('views');
      if (viewsEl) {
        viewsEl.innerHTML = `<div class="glass empty" style="color:var(--rouge);">
          Erreur serveur : ${window.APP._esc(e.message)}
        </div>`;
      }
    }
  });

  return { go, register, checkDependencies };
})();