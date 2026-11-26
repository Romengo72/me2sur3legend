// C:\Me\AppMoney\MeParisPortifs\js\admin-panel.js
// v6.2.3 — Correction enregistrement API Keys + Masquage sécurisé
(function () {
  'use strict';

  if (typeof Navigation === 'undefined') {
    console.error('[admin-panel.js] Navigation non défini.');
    return;
  }

  const state = {
    activeTab: 'overview',
    cache: {
      users: null, ads: null, news: null, promoters: null,
      contacts: null, deletions: null, apiKeys: null,
      propositions: null, constantes: null, settings: null
    }
  };

  /* ═══════════════════════════════════════════════════════════════ */
  /* 24 ONGLETS DE L'ADMINISTRATION                                 */
  /* ═══════════════════════════════════════════════════════════════ */
  const TABS = [
    ['overview',      '📊 Vue d\'ensemble'],
    ['users',         '👥 Utilisateurs'],
    ['permissions',   '🔑 Permissions'],
    ['balance',       '💰 Soldes'],
    ['collect',       '💼 Collecte'],
    ['withdrawals',   '💸 Retraits en attente'],
    ['margins',       '📈 Marges silencieuses'],
    ['suspensions',   '⏸️ Suspensions IA'],
    ['constantes',    '⚙️ Constantes'],
    ['plans',         '💎 Abonnements'],
    ['ads',           '📢 Publicités'],
    ['promoters',     '📣 Annonceurs'],
    ['news',          '📰 Actualités'],
    ['faq',           '❓ FAQ & Avis'],
    ['contact',       '📬 Messages'],
    ['deletion',      '🗑️ Suppressions'],
    ['api-keys',      '🔐 API Keys'],
    ['propositions',  '📋 Propositions'],
    ['saisies',       '📝 Saisies'],
    ['ia-validation', '🤖 Validation IA'],
    ['ia-odds',       '🎯 Cotes IA'],
    ['finance',       '💰 Finance'],
    ['settings',      '🏢 Paramètres'],
    ['security',      '🔒 Sécurité']
  ];

  /* ═══════════════════════════════════════════════════════════════ */
  /* HELPERS                                                        */
  /* ═══════════════════════════════════════════════════════════════ */
  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
  const fmtDate = (v) => v ? new Date(v).toLocaleString('fr-FR') : '—';
  const esc = (s) => (window.APP && window.APP._esc)
    ? window.APP._esc(s) : String(s ?? '');

  async function safeGet(path, fallback = null) {
    try { return await API.get(path); }
    catch (e) { console.warn('[admin-panel] GET', path, '→', e.message); return fallback; }
  }
  async function safePost(path, body) {
    try { return await API.post(path, body); }
    catch (e) { UI.toast(e.data?.error || e.message, 'error'); return null; }
  }

  async function uiPrompt(opts) {
    if (window.UI && typeof UI.prompt === 'function') return await UI.prompt(opts);
    return window.prompt(opts.message || opts.title || 'Saisie', opts.defaultValue || '');
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* RENDU PRINCIPAL                                                */
  /* ═══════════════════════════════════════════════════════════════ */
  async function render() {
    const el = document.getElementById('view-admin');
    if (!el) return;

    if (!window.CURRENT_USER || window.CURRENT_USER.role !== 'admin') {
      el.innerHTML = `
        <div class="glass empty" style="padding:40px;text-align:center;">
          <div style="font-size:2.5rem;">🚫</div>
          <h2>Accès réservé à l'administrateur</h2>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div class="admin-tabs-bar">
        ${TABS.map(([k, label]) => `
          <button class="admin-tab-btn ${k === state.activeTab ? 'active' : ''}"
                  data-tab="${k}">${label}</button>
        `).join('')}
      </div>
      <div id="admin-content" class="admin-content glass">
        <div class="empty"><span class="spinner"></span> Chargement…</div>
      </div>
    `;

    el.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeTab = btn.dataset.tab;
        el.querySelectorAll('.admin-tab-btn').forEach(b =>
          b.classList.toggle('active', b === btn));
        renderTab(state.activeTab);
      });
    });

    renderTab(state.activeTab);
  }

  async function renderTab(tab) {
    const c = document.getElementById('admin-content');
    if (!c) return;
    c.innerHTML = '<div class="empty"><span class="spinner"></span> Chargement…</div>';

    try {
      switch (tab) {
        case 'overview':      return await tabOverview(c);
        case 'users':         return await tabUsers(c);
        case 'permissions':   return await tabPermissions(c);
        case 'balance':       return await tabBalance(c);
        case 'collect':       return await tabCollect(c);
        case 'withdrawals':   return await tabWithdrawals(c);
        case 'margins':       return await tabMargins(c);
        case 'suspensions':   return await tabSuspensions(c);
        case 'constantes':    return await tabConstantes(c);
        case 'plans':         return await tabPlans(c);
        case 'ads':           return await tabAds(c);
        case 'promoters':     return await tabPromoters(c);
        case 'news':          return await tabNews(c);
        case 'faq':           return await tabFaq(c);
        case 'contact':       return await tabContact(c);
        case 'deletion':      return await tabDeletion(c);
        case 'api-keys':      return await tabApiKeys(c);
        case 'propositions':  return await tabPropositions(c);
        case 'saisies':       return await tabSaisies(c);
        case 'ia-validation': return await tabIaValidation(c);
        case 'ia-odds':       return await tabIaOdds(c);
        case 'settings':      return await tabSettings(c);
        case 'security':      return await tabSecurity(c);
        case 'finance':       return window.AdminFinance.render(c);
        default: c.innerHTML = '<div class="empty">Onglet inconnu</div>';
      }
    } catch (e) {
      console.error('[admin-panel]', tab, e);
      c.innerHTML = `<div class="empty" style="color:var(--rouge);">
        Erreur : ${esc(e.message)}</div>`;
    }
  }

  /* ═══════════════ 1. VUE D'ENSEMBLE ═══════════════ */
  async function tabOverview(c) {
    const s = await safeGet('/admin/stats/overview', {});
    const stats = await safeGet('/admin/saisies-stats', {});
    c.innerHTML = `
      <h2 style="margin-bottom:20px;">📊 Vue d'ensemble</h2>
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
        <div class="stat-card"><div class="stat-label">Utilisateurs</div>
          <div class="stat-value">${s.users || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Saisies validées</div>
          <div class="stat-value">${stats.valides || s.saisies || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Matchs en attente</div>
          <div class="stat-value" style="color:var(--orange);">${stats.matches_en_attente || 0}</div></div>
        <div class="stat-card"><div class="stat-label">Total misé</div>
          <div class="stat-value">${fmt(s.mises)} XAF</div></div>
        <div class="stat-card"><div class="stat-label">Budget Fonctionnement</div>
          <div class="stat-value">${fmt(s.bf)} XAF</div></div>
        <div class="stat-card"><div class="stat-label">Soldes en circulation</div>
          <div class="stat-value">${fmt(s.totalBalances)} XAF</div></div>
        <div class="stat-card"><div class="stat-label">Marges collectées</div>
          <div class="stat-value" style="color:var(--vert);">${fmt(s.totalMargins)} XAF</div></div>
      </div>`;
  }

  /* ═══════════════ 2. UTILISATEURS ═══════════════ */
  async function tabUsers(c) {
    const users = await safeGet('/admin/users', []);
    state.cache.users = users;
    const admins  = users.filter(u => u.role === 'admin').length;
    const regular = users.length - admins;

    c.innerHTML = `
      <h2 style="margin-bottom:16px;">👥 Utilisateurs</h2>
      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-label">Total</div>
          <div class="stat-value">${users.length}</div></div>
        <div class="stat-card"><div class="stat-label">Utilisateurs</div>
          <div class="stat-value">${regular}</div></div>
        <div class="stat-card"><div class="stat-label">Admins</div>
          <div class="stat-value">${admins}</div></div>
      </div>
      <div class="admin-search">
        <input type="text" class="input" id="admin-users-search" placeholder="🔍 Rechercher par email…">
      </div>
      <div class="admin-table-wrap">
        <table class="data">
          <thead><tr>
            <th>Email</th><th>Rôle</th><th>Catégorie</th><th>Solde</th><th>Actions</th>
          </tr></thead>
          <tbody id="admin-users-tbody">
            ${users.map(u => {
              const catBadge = u.role === 'admin'
                ? '<span class="badge-role admin">🛡️ ADMIN</span>'
                : u.category === 'legendaire'
                  ? '<span class="badge-role" style="background:linear-gradient(135deg,#22d3ee,#7c3aed);color:#fff;">💎 LÉGENDAIRE</span>'
                  : u.category === 'vip'
                    ? '<span class="badge-role" style="background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;">👑 VIP</span>'
                    : u.category === 'premium'
                      ? '<span class="badge-role" style="background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;">⭐ PREMIUM</span>'
                      : '<span class="badge-role user">👤 SIMPLE</span>';
              return `
              <tr data-email="${esc(u.email)}">
                <td>${esc(u.email)}</td>
                <td><span class="badge-role ${u.role}">${u.role}</span></td>
                <td>${catBadge}</td>
                <td>${fmt(u.balance)} XAF</td>
                <td>
                  <button class="btn ghost sm" data-action="balance" data-email="${esc(u.email)}">💰 Ajuster</button>
                  <button class="btn ghost sm" data-action="permissions" data-email="${esc(u.email)}">🔑 Perms</button>
                  <button class="btn ghost sm" data-action="reset-pwd" data-email="${esc(u.email)}">🔐 MDP</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    document.getElementById('admin-users-search')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#admin-users-tbody tr').forEach(tr => {
        tr.style.display = tr.dataset.email.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    c.querySelectorAll('[data-action="balance"]').forEach(b =>
      b.addEventListener('click', () => {
        state.activeTab = 'balance';
        document.querySelectorAll('.admin-tab-btn').forEach(x =>
          x.classList.toggle('active', x.dataset.tab === 'balance'));
        renderTab('balance').then(() => {
          const inp = document.getElementById('balance-email');
          if (inp) inp.value = b.dataset.email;
        });
      }));

    c.querySelectorAll('[data-action="permissions"]').forEach(b =>
      b.addEventListener('click', () => {
        state.activeTab = 'permissions';
        document.querySelectorAll('.admin-tab-btn').forEach(x =>
          x.classList.toggle('active', x.dataset.tab === 'permissions'));
        renderTab('permissions').then(() => {
          const inp = document.getElementById('perm-email');
          if (inp) { inp.value = b.dataset.email; inp.dispatchEvent(new Event('change')); }
        });
      }));

    c.querySelectorAll('[data-action="reset-pwd"]').forEach(b =>
      b.addEventListener('click', () => {
        state.activeTab = 'security';
        document.querySelectorAll('.admin-tab-btn').forEach(x =>
          x.classList.toggle('active', x.dataset.tab === 'security'));
        renderTab('security').then(() => {
          const inp = document.getElementById('sec-reset-email');
          if (inp) inp.value = b.dataset.email;
        });
      }));
  }

  /* ═══════════════ 3. PERMISSIONS ═══════════════ */
  const PERMS_DEF = [
    ['can_saisir',          'Saisir des matchs'],
    ['can_valider',         'Valider ses saisies'],
    ['can_voir_resultats',  'Voir les résultats'],
    ['can_voir_historique', 'Voir son historique'],
    ['can_voir_stats',      'Voir les statistiques'],
    ['can_utiliser_ia',     'Utiliser l\'IA'],
    ['can_retirer',         'Effectuer des retraits'],
    ['can_deposer',         'Effectuer des dépôts'],
    ['can_parrainer',       'Accès au parrainage'],
    ['can_voir_news',       'Voir les actualités'],
    ['can_create_permissions', 'Créer des permissions'],
    ['can_use_vip_ia',      'Utiliser l\'IA VIP'],
    ['can_auto_settle',     'Règlement auto IA']
  ];

  async function tabPermissions(c) {
    c.innerHTML = `<div class="empty"><span class="spinner"></span> Chargement des groupes...</div>`;

    const groups = await safeGet('/admin/permission-groups', []);

    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🔑 Permissions</h2>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px;">

        <!-- SECTION 1 : PERMISSIONS PAR GROUPE -->
        <div class="glass" style="padding:20px;">
          <h3 style="margin-bottom:14px; font-size:1.1rem;">👥 Par Groupe (Catégories)</h3>
          <p style="color:var(--txt-dim);font-size:.85rem;margin-bottom:16px;">
            Définissez les permissions par défaut. Les modifications s'appliquent à tous les membres de la catégorie.
          </p>

          <div class="admin-field" style="margin-bottom:16px;">
            <label>Sélectionner la catégorie</label>
            <select class="input" id="perm-group-select">
              ${groups.length === 0
                ? '<option value="">Aucun groupe configuré</option>'
                : groups.map(g => `<option value="${g.category}">${g.description || g.category.toUpperCase()}</option>`).join('')}
            </select>
          </div>

          <div id="perm-group-form" style="display:grid; gap:10px;">
            ${groups.length === 0
              ? '<p style="color:var(--rouge);">Aucun groupe de permissions trouvé. Exécutez la migration SQL.</p>'
              : ''}
          </div>

          <div style="margin-top:20px; text-align:right;">
            <button class="btn" id="perm-group-save" ${groups.length === 0 ? 'disabled' : ''}>💾 Enregistrer le groupe</button>
          </div>
        </div>

        <!-- SECTION 2 : OVERRIDES UTILISATEUR -->
        <div class="glass" style="padding:20px;">
          <h3 style="margin-bottom:14px; font-size:1.1rem;">👤 Par Utilisateur (Overrides)</h3>
          <p style="color:var(--txt-dim);font-size:.85rem;margin-bottom:16px;">
            Modifiez les permissions d'un utilisateur spécifique. Ces réglages écrasent ceux de son groupe.
          </p>

          <div class="admin-field" style="margin-bottom:16px;">
            <label>Email de l'utilisateur</label>
            <input type="text" class="input" id="perm-email" placeholder="user@example.com">
          </div>

          <div id="perm-user-form" style="display:none; display:grid; gap:10px;">
            <!-- Rempli par JS -->
          </div>

          <div id="perm-user-actions" style="margin-top:20px; text-align:right; display:none;">
            <button class="btn ghost sm" id="perm-user-reset" style="margin-right:8px;">Réinitialiser (Groupe)</button>
            <button class="btn" id="perm-user-save">💾 Enregistrer l'utilisateur</button>
          </div>
        </div>
      </div>
    `;

    const groupSelect = document.getElementById('perm-group-select');
    const groupForm = document.getElementById('perm-group-form');

    function renderGroupForm(category) {
      const group = groups.find(g => g.category === category);
      if (!group) return;
      const perms = typeof group.permissions === 'string' ? JSON.parse(group.permissions) : group.permissions;

      groupForm.innerHTML = PERMS_DEF.map(([key, label]) => `
        <label class="perm-item" style="display:flex; justify-content:space-between; padding:8px 12px; background:rgba(10,10,25,.4); border-radius:8px; cursor:pointer;">
          <span>${label}</span>
          <input type="checkbox" data-group-perm="${key}" ${perms[key] ? 'checked' : ''} style="accent-color:var(--violet); width:18px; height:18px;">
        </label>
      `).join('');
    }

    groupSelect?.addEventListener('change', (e) => renderGroupForm(e.target.value));
    if (groups.length > 0) renderGroupForm(groups[0].category);

    document.getElementById('perm-group-save')?.addEventListener('click', async () => {
      const category = groupSelect.value;
      const permissions = {};
      groupForm.querySelectorAll('[data-group-perm]').forEach(cb => {
        permissions[cb.dataset.groupPerm] = cb.checked;
      });

      try {
        await API.put(`/admin/permission-groups/${category}`, { permissions });
        UI.toast(`✅ Permissions du groupe ${category} enregistrées`, 'success');
      } catch (err) {
        UI.toast('❌ ' + (err.data?.error || err.message), 'error');
      }
    });

    const emailInp = document.getElementById('perm-email');
    const userForm = document.getElementById('perm-user-form');
    const userActions = document.getElementById('perm-user-actions');

    emailInp?.addEventListener('change', async () => {
      const email = emailInp.value.trim();
      if (!email) {
        userForm.style.display = 'none';
        userActions.style.display = 'none';
        return;
      }

      try {
        userForm.style.display = 'grid';
        userActions.style.display = 'block';
        userForm.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Chargement...';

        const data = await safeGet(`/admin/permissions?user_email=${encodeURIComponent(email)}`, null);

        if (!data) {
          userForm.innerHTML = `<p style="color:var(--rouge);">Utilisateur introuvable.</p>`;
          return;
        }

        const group = groups.find(g => g.category === data.category);
        const basePerms = group ? (typeof group.permissions === 'string' ? JSON.parse(group.permissions) : group.permissions) : {};

        userForm.innerHTML = PERMS_DEF.map(([key, label]) => {
          const baseVal = !!basePerms[key];
          const hasOverride = data.overrides && data.overrides[key] !== undefined;
          const isChecked = hasOverride ? data.overrides[key] : baseVal;

          return `
            <label class="perm-item" style="display:flex; justify-content:space-between; padding:8px 12px; background:rgba(10,10,25,.4); border-radius:8px; cursor:pointer; ${hasOverride ? 'border-left:3px solid var(--orange);' : ''}">
              <div>
                <span>${label}</span>
                <div style="font-size:.7rem;color:var(--txt-dim);">Défaut: ${baseVal ? 'Oui' : 'Non'} ${hasOverride ? '(Modifié)' : ''}</div>
              </div>
              <input type="checkbox" data-user-perm="${key}" ${isChecked ? 'checked' : ''} style="accent-color:var(--violet); width:18px; height:18px;">
            </label>
          `;
        }).join('');

      } catch (err) {
        userForm.innerHTML = `<p style="color:var(--rouge);">Erreur: ${esc(err.message)}</p>`;
      }
    });

    document.getElementById('perm-user-save')?.addEventListener('click', async () => {
      const email = emailInp.value.trim();
      if (!email) return;

      const permissions = {};
      userForm.querySelectorAll('[data-user-perm]').forEach(cb => {
        permissions[cb.dataset.userPerm] = cb.checked;
      });

      try {
        await API.post(`/admin/permissions`, { user_email: email, permissions });
        UI.toast('✅ Permissions utilisateur enregistrées', 'success');
      } catch (err) {
        UI.toast('❌ ' + (err.data?.error || err.message), 'error');
      }
    });

    document.getElementById('perm-user-reset')?.addEventListener('click', async () => {
      const email = emailInp.value.trim();
      if (!email) return;

      const ok = await UI.confirm('Réinitialiser toutes les permissions de cet utilisateur sur celles de son groupe ?', 'Réinitialisation');
      if (!ok) return;

      try {
        await API.post(`/admin/permissions`, { user_email: email, permissions: {} });
        UI.toast('Veuillez recharger pour voir les modifications', 'info');
        emailInp.dispatchEvent(new Event('change'));
      } catch (err) {
        UI.toast('❌ ' + (err.data?.error || err.message), 'error');
      }
    });
  }

  /* ═══════════════ 4. SOLDES ═══════════════ */
  async function tabBalance(c) {
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">💰 Ajustement de solde</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        Plafond : <strong>±1 000 000 XAF</strong> par opération. Note obligatoire (3 car. min.).
        Toute opération est journalisée dans <code>security_log</code>.
      </p>
      <div class="admin-form">
        <div class="admin-field">
          <label>Email de l'utilisateur</label>
          <input type="text" class="input" id="balance-email" placeholder="user@example.com">
        </div>
        <div class="admin-field">
          <label>Delta (positif = crédit, négatif = débit)</label>
          <input type="number" step="0.01" class="input" id="balance-delta" placeholder="ex: 5000 ou -2000" min="-1000000" max="1000000">
        </div>
        <div class="admin-field">
          <label>Note (obligatoire, 3 car. min.)</label>
          <input type="text" class="input" id="balance-note" placeholder="Raison de l'ajustement">
        </div>
        <div style="text-align:right;margin-top:20px;">
          <button class="btn" id="balance-submit">💾 Appliquer</button>
        </div>
      </div>`;

    document.getElementById('balance-submit')?.addEventListener('click', async () => {
      const user_email = document.getElementById('balance-email').value.trim();
      const delta = Number(document.getElementById('balance-delta').value);
      const note = document.getElementById('balance-note').value.trim();

      if (!user_email) return UI.toast('Email requis', 'warn');
      if (!delta) return UI.toast('Delta non nul requis', 'warn');
      if (Math.abs(delta) > 1_000_000) return UI.toast('Plafond : ±1 000 000 XAF', 'warn');
      if (note.length < 3) return UI.toast('Note obligatoire (3 car. min.)', 'warn');

      const ok = await UI.confirm(
        `Confirmez l'ajustement :<br><br>` +
        `<strong>${delta > 0 ? '+' : ''}${fmt(delta)} XAF</strong> pour <strong>${esc(user_email)}</strong><br>` +
        `Note : ${esc(note)}`,
        '💰 Ajustement de solde', { html: true });
      if (!ok) return;

      const r = await safePost('/admin/adjust-balance', { user_email, delta, note });
      if (r) {
        UI.toast(`✅ Solde ajusté : ${delta > 0 ? '+' : ''}${fmt(delta)} XAF`, 'success');
        document.getElementById('balance-delta').value = '';
        document.getElementById('balance-note').value = '';
      }
    });
  }

  /* ═══════════════ 5. COLLECTE DES DÉCIMALES ═══════════════ */
  async function tabCollect(c) {
    const s = await safeGet('/admin/stats/overview', {});
    const estimation = (s.users || 0) * 0.5;

    c.innerHTML = `
      <h2 style="margin-bottom:16px;">💼 Collecte des décimales</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        La collecte prélève <strong>uniquement la partie décimale</strong> du solde de chaque utilisateur.
        Le capital entier (partie avant la virgule) reste intact. Cycle automatique : 7 jours.
      </p>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">Utilisateurs</div>
          <div class="stat-value">${s.users || 0}</div></div>
        <div class="stat-card"><div class="stat-label">BF actuel</div>
          <div class="stat-value">${fmt(s.bf)} XAF</div></div>
        <div class="stat-card" style="background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.3);">
          <div class="stat-label">Estimation décimales</div>
          <div class="stat-value" style="color:var(--vert);">~ ${fmt(estimation)} XAF</div>
          <div style="font-size:.75rem;color:var(--txt-dim);margin-top:4px;">~0,50 XAF par utilisateur</div>
        </div>
      </div>
      <div style="margin-top:20px;padding:14px 18px;background:rgba(16,185,129,.08);border-left:4px solid var(--vert);border-radius:10px;">
        <strong style="color:var(--vert);">✅ Aucun risque pour les utilisateurs</strong>
        <p style="color:var(--txt-dim);font-size:.85rem;margin-top:6px;">
          Seul le reliquat centime est prélevé. Le solde entier de chaque utilisateur reste sur son compte.
          Les fonds collectés alimentent le Budget Fonctionnement.
        </p>
      </div>
      <div style="text-align:center;margin-top:24px;">
        <button class="btn btn-lg" id="collect-btn">
          💼 Collecter les décimales
        </button>
      </div>`;

    document.getElementById('collect-btn')?.addEventListener('click', async () => {
      const ok = await UI.confirm(
        `Confirmez-vous la collecte des <strong>parties décimales</strong> ?<br><br>` +
        `Seront prélevés : <strong>uniquement les centimes</strong> ` +
        `(ex: 0,67 XAF sur un solde de 12 345,67 XAF).<br><br>` +
        `<strong style="color:var(--vert);">Le capital entier des utilisateurs reste intact.</strong>`,
        '💼 Collecte des décimales',
        { html: true });
      if (!ok) return;

      try {
        await UI.withLoader(async () => {
          const r = await API.post('/admin/collect-funds', {});
          UI.toast(`✅ ${fmt(r.collected)} XAF collectés sur ${r.nbUsers} utilisateur(s)`, 'success', 6000);
        });
        renderTab('collect');
      } catch (e) {
        UI.toast('❌ ' + (e.data?.error || e.message), 'error');
      }
    });
  }

  /* ═══════════════ 6. RETRAITS EN ATTENTE ═══════════════ */
  async function tabWithdrawals(c) {
    const list = await safeGet('/admin/withdrawals/pending', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">💸 Retraits en attente d'approbation</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        Retraits dépassant le seuil automatique ou signalés. Le montant affiché est le <strong>net reçu</strong> ;
        le total débité inclut les frais de la catégorie.
      </p>
      ${list.length === 0 ? '<div class="empty">Aucun retrait en attente.</div>' : `
        <div class="admin-list">
          ${list.map(w => `
            <div class="admin-item">
              <div>
                <strong>${esc(w.user_email)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  Net : <strong>${fmt(w.amount)} ${esc(w.devise)}</strong> · ${fmtDate(w.created_at)}
                </div>
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn ghost sm" data-approve="${w.id}" style="color:var(--vert); border-color:var(--vert);">✅ Approuver</button>
                <button class="btn ghost sm" data-reject="${w.id}" style="color:var(--rouge); border-color:var(--rouge);">❌ Rejeter</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}`;

    c.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirm('Approuver ce retrait ? Le montant net + frais sera débité du solde.')) return;
      const r = await safePost(`/admin/withdrawals/${b.dataset.approve}/approve`, {});
      if (r) { UI.toast(r.message || 'Retrait approuvé', 'success'); renderTab('withdrawals'); }
    }));

    c.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirm('Rejeter ce retrait ?')) return;
      const r = await safePost(`/admin/withdrawals/${b.dataset.reject}/reject`, {});
      if (r) { UI.toast('Retrait rejeté', 'info'); renderTab('withdrawals'); }
    }));
  }

  /* ═══════════════ 7. MARGES SILENCIEUSES ═══════════════ */
  async function tabMargins(c) {
    const data = await safeGet('/admin/finance/margins', { margins: [], totals: {} });
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">📈 Marges silencieuses</h2>
      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-card"><div class="stat-label">Total Marges</div>
          <div class="stat-value" style="color:var(--cyan);">${fmt(data.totals?.total)} XAF</div></div>
        <div class="stat-card"><div class="stat-label">Sur Mises</div>
          <div class="stat-value">${fmt(data.totals?.mises)} XAF</div></div>
        <div class="stat-card"><div class="stat-label">Sur Gains</div>
          <div class="stat-value">${fmt(data.totals?.gains)} XAF</div></div>
        <div class="stat-card"><div class="stat-label">Sur Retraits</div>
          <div class="stat-value">${fmt(data.totals?.retraits)} XAF</div></div>
      </div>
      <div class="admin-table-wrap">
        <table class="data">
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Type</th><th>Montant</th><th>Note</th></tr></thead>
          <tbody>
            ${data.margins.map(m => `
              <tr>
                <td>${fmtDate(m.created_at)}</td>
                <td>${esc(m.user_email)}</td>
                <td><span class="badge-tab">${esc(m.type)}</span></td>
                <td style="color:var(--vert);font-weight:700;">${fmt(m.montant)} XAF</td>
                <td style="font-size:.75rem;color:var(--txt-dim);">${esc(m.note)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ═══════════════ 8. SUSPENSIONS IA ═══════════════ */
  async function tabSuspensions(c) {
    const list = await safeGet('/admin/ia/suspensions?active=1', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">⏸️ Suspensions IA (Gains successifs)</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">Utilisateurs dont les mises sont bloquées (retraits autorisés).</p>
      ${list.length === 0 ? '<div class="empty">Aucune suspension active.</div>' : `
        <div class="admin-list">
          ${list.map(s => `
            <div class="admin-item">
              <div>
                <strong>${esc(s.user_email)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  Gains (7j) : <strong style="color:var(--orange);">${fmt(s.total_won)} XAF</strong> ·
                  Seuil : ${fmt(s.threshold)} XAF ·
                  Fin : ${fmtDate(s.suspended_until)}
                </div>
              </div>
              <button class="btn ghost sm" data-lift="${s.id}">🔓 Lever</button>
            </div>
          `).join('')}
        </div>
      `}`;

    c.querySelectorAll('[data-lift]').forEach(b => b.addEventListener('click', async () => {
      if (!await UI.confirm('Lever cette suspension ?')) return;
      const r = await safePost(`/admin/ia/suspensions/${b.dataset.lift}/lift`, {});
      if (r) { UI.toast('Suspension levée', 'success'); renderTab('suspensions'); }
    }));
  }

  /* ═══════════════ 9. CONSTANTES ═══════════════ */
  async function tabConstantes(c) {
    const k = await safeGet('/constantes', {});
    state.cache.constantes = k;
    const labels = {
      CAP: 'Capital initial', D4: 'Coefficient distribution',
      E3: 'Échelle secondaire', B3: 'Bonus cote 1',
      E4: 'Marge cote N', G4: 'Marge cote 2',
      L7: 'Ratio de couverture', BUDGET_FONCTIONNEMENT: 'Budget Fonctionnement'
    };
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">⚙️ Constantes de calcul</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        Ces valeurs influencent <strong>tous les calculs de mises</strong>. Modifiez avec précaution.
      </p>
      <div class="admin-form">
        ${Object.keys(k).map(key => `
          <div class="admin-field">
            <label>${labels[key] || key}
              <span style="color:var(--txt-dim);font-size:.75rem;">(${key})</span>
            </label>
            <input type="number" step="0.0001" class="input"
                   data-const="${key}" value="${k[key]}">
          </div>`).join('')}
        <div style="text-align:right;margin-top:20px;">
          <button class="btn" id="const-save">💾 Enregistrer</button>
        </div>
      </div>`;

    document.getElementById('const-save')?.addEventListener('click', async () => {
      const inputs = c.querySelectorAll('[data-const]');
      let count = 0;
      for (const inp of inputs) {
        const key = inp.dataset.const;
        const value = Number(inp.value);
        if (isNaN(value)) continue;
        if (value === Number(state.cache.constantes[key])) continue;
        const r = await safePost(`/constantes/${key}`, { value });
        if (r !== null) count++;
      }
      UI.toast(count > 0 ? `✅ ${count} constante(s) mise(s) à jour` : 'Aucun changement',
               count > 0 ? 'success' : 'info');
      state.cache.constantes = null;
    });
  }

  /* ═══════════════ 10. PLANS / ABONNEMENTS ═══════════════ */
  async function tabPlans(c) {
    const plans = await safeGet('/public/plans', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">💎 Gestion des Abonnements</h2>
      ${plans.length === 0 ? '<div class="empty">Aucun plan configuré.</div>' : `
        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr));">
          ${plans.map(p => `
            <div class="stat-card glass" style="padding:20px;">
              <div style="font-size:1.2rem;font-weight:800;color:var(--cyan);margin-bottom:8px;">${esc(p.name || p.nom)}</div>
              <div style="font-size:1.5rem;font-weight:900;margin-bottom:12px;">${fmt(p.price_monthly)} XAF</div>
              <div style="font-size:.8rem;color:var(--txt-dim);margin-bottom:12px;">${esc(p.description)}</div>
              <ul style="font-size:.82rem;color:var(--txt-dim);padding-left:20px;">
                ${(p.features || []).map(f => `<li>${esc(f)}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>`}`;
  }

  /* ═══════════════ 11. PUBLICITÉS ═══════════════ */
  async function tabAds(c) {
    const ads = await safeGet('/admin/ads', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">📢 Publicités</h2>
      <div class="admin-form" style="margin-bottom:24px;">
        <div class="admin-field-row">
          <div class="admin-field"><label>Titre</label>
            <input type="text" class="input" id="ad-titre"></div>
          <div class="admin-field"><label>Image URL</label>
            <input type="text" class="input" id="ad-image"></div>
        </div>
        <div class="admin-field"><label>Contenu</label>
          <textarea class="input" id="ad-contenu" rows="2"></textarea></div>
        <div class="admin-field-row">
          <div class="admin-field"><label>Début</label>
            <input type="datetime-local" class="input" id="ad-debut"></div>
          <div class="admin-field"><label>Fin</label>
            <input type="datetime-local" class="input" id="ad-fin"></div>
        </div>
        <div style="text-align:right;">
          <button class="btn" id="ad-create">➕ Ajouter</button>
        </div>
      </div>
      <div class="admin-list">
        ${ads.length === 0 ? '<div class="empty">Aucune publicité</div>' :
          ads.map(a => `
            <div class="admin-item">
              <div>
                <strong>${esc(a.titre || 'Sans titre')}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  ${a.actif ? '🟢 Actif' : '⚪ Inactif'}
                </div>
              </div>
              <button class="btn ghost sm" data-ad-del="${a.id}">🗑️</button>
            </div>`).join('')}
      </div>`;

    document.getElementById('ad-create')?.addEventListener('click', async () => {
      const body = {
        titre: document.getElementById('ad-titre').value.trim(),
        contenu: document.getElementById('ad-contenu').value.trim(),
        image_url: document.getElementById('ad-image').value.trim(),
        actif: true,
        date_debut: document.getElementById('ad-debut').value || null,
        date_fin: document.getElementById('ad-fin').value || null
      };
      if (!body.titre) return UI.toast('Titre requis', 'warn');
      const r = await safePost('/admin/ads', body);
      if (r) { UI.toast('✅ Publicité ajoutée', 'success'); renderTab('ads'); }
    });

    c.querySelectorAll('[data-ad-del]').forEach(b =>
      b.addEventListener('click', async () => {
        const ok = await UI.confirm('Supprimer cette publicité ?');
        if (!ok) return;
        try {
          await API.del(`/admin/ads/${b.dataset.adDel}`);
          UI.toast('Publicité supprimée', 'info');
          renderTab('ads');
        } catch (e) { UI.toast('Erreur : ' + e.message, 'error'); }
      }));
  }

  /* ═══════════════ 12. ANNONCEURS ═══════════════ */
  async function tabPromoters(c) {
    const list = await safeGet('/admin/promoters', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">📣 Demandes d'annonceurs</h2>
      ${list.length === 0 ? '<div class="empty">Aucune demande reçue</div>' :
        `<div class="admin-list">
          ${list.map(p => `
            <div class="admin-item">
              <div>
                <strong>${esc(p.nom || p.email)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  ${esc(p.email)} · ${fmtDate(p.date)}
                </div>
                <div style="font-size:.85rem;margin-top:6px;">${esc(p.message || '')}</div>
              </div>
              <span class="badge-role ${p.statut === 'approved' ? 'admin' : 'user'}">${esc(p.statut)}</span>
            </div>`).join('')}
        </div>`}`;
  }

  /* ═══════════════ 13. ACTUALITÉS ═══════════════ */
  async function tabNews(c) {
    const list = await safeGet('/admin/news', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">📰 Actualités</h2>
      <div class="admin-form" style="margin-bottom:24px;">
        <div class="admin-field"><label>Titre</label>
          <input type="text" class="input" id="news-titre"></div>
        <div class="admin-field"><label>Contenu</label>
          <textarea class="input" id="news-contenu" rows="4"></textarea></div>
        <div class="admin-field"><label>Image URL</label>
          <input type="text" class="input" id="news-image"></div>
        <div style="text-align:right;">
          <button class="btn" id="news-create">➕ Publier</button>
        </div>
      </div>
      <div class="admin-list">
        ${list.length === 0 ? '<div class="empty">Aucune actualité</div>' :
          list.map(n => `
            <div class="admin-item">
              <div>
                <strong>${esc(n.titre)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">${fmtDate(n.date)}</div>
              </div>
              <button class="btn ghost sm" data-news-del="${n.id}">🗑️</button>
            </div>`).join('')}
      </div>`;

    document.getElementById('news-create')?.addEventListener('click', async () => {
      const body = {
        titre: document.getElementById('news-titre').value.trim(),
        contenu: document.getElementById('news-contenu').value.trim(),
        image_url: document.getElementById('news-image').value.trim(),
        publie: true
      };
      if (!body.titre) return UI.toast('Titre requis', 'warn');
      const r = await safePost('/admin/news', body);
      if (r) { UI.toast('✅ Actualité publiée', 'success'); renderTab('news'); }
    });

    c.querySelectorAll('[data-news-del]').forEach(b =>
      b.addEventListener('click', async () => {
        try {
          await API.del(`/admin/news/${b.dataset.newsDel}`);
          UI.toast('Supprimé', 'info');
          renderTab('news');
        } catch (e) { UI.toast(e.message, 'error'); }
      }));
  }

  /* ═══════════════ 14. FAQ & AVIS ═══════════════ */
  async function tabFaq(c) {
    const faqs = await safeGet('/admin/faq', []);
    const testimonials = await safeGet('/admin/testimonials', []);

    c.innerHTML = `
      <h2 style="margin-bottom:16px;">❓ FAQ & Avis</h2>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="glass" style="padding:20px;">
          <h3 style="margin-bottom:14px;">Questions Fréquentes (${faqs.length})</h3>
          <div class="admin-list">
            ${faqs.map(f => `
              <div class="admin-item">
                <div>
                  <strong>${esc(f.question)}</strong>
                  <div style="font-size:.82rem;color:var(--txt-dim);">${esc(f.reponse)}</div>
                </div>
              </div>
            `).join('') || '<div class="empty">Aucune FAQ.</div>'}
          </div>
        </div>

        <div class="glass" style="padding:20px;">
          <h3 style="margin-bottom:14px;">Témoignages (${testimonials.length})</h3>
          <div class="admin-list">
            ${testimonials.map(t => `
              <div class="admin-item">
                <div>
                  <strong>${esc(t.auteur)}</strong> (${esc(t.pays)})
                  <div style="color:var(--orange);font-size:.9rem;">${'★'.repeat(t.note)}${'☆'.repeat(5-t.note)}</div>
                  <div style="font-size:.82rem;color:var(--txt-dim);font-style:italic;">"${esc(t.contenu)}"</div>
                </div>
              </div>
            `).join('') || '<div class="empty">Aucun avis.</div>'}
          </div>
        </div>
      </div>`;
  }

  /* ═══════════════ 15. MESSAGERIE (CONTACT) ═══════════════ */
  async function tabContact(c) {
    let currentBox = 'in';

    async function loadMessages() {
      const listEl = document.getElementById('contact-list');
      if (!listEl) return;
      listEl.innerHTML = '<div class="empty"><span class="spinner"></span> Chargement...</div>';

      try {
        const list = await safeGet(`/admin/contact-messages?box=${currentBox}`, []);

        if (list.length === 0) {
          listEl.innerHTML = `
            <div class="empty" style="padding:40px;text-align:center;">
              <div style="font-size:2rem;margin-bottom:10px;">📭</div>
              <div style="color:var(--txt-dim);">${currentBox === 'in' ? 'Aucun message reçu.' : 'Aucun message envoyé.'}</div>
            </div>`;
          return;
        }

        listEl.innerHTML = `
          <div class="admin-list">
            ${list.map(m => `
              <div class="admin-item ${m.lu ? '' : 'unread'}" style="align-items:flex-start;">
                <div style="flex:1;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                    <strong style="color:var(--cyan);">${esc(m.sujet || 'Sans objet')}</strong>
                    <span style="font-size:.75rem;color:var(--txt-dim);">${new Date(m.date).toLocaleString('fr-FR')}</span>
                  </div>
                  <div style="font-size:.85rem;margin-bottom:4px;">
                    ${currentBox === 'in'
                      ? `De : <strong>${esc(m.nom)}</strong> &lt;${esc(m.email)}&gt;`
                      : `À : <strong>${esc(m.email)}</strong>`}
                  </div>
                  <div style="font-size:.85rem;color:var(--txt-dim);line-height:1.5;margin-bottom:8px;">
                    ${esc(m.message)}
                  </div>
                  ${currentBox === 'in' && !m.lu ? `
                    <button class="btn ghost sm" data-mark="${m.id}">✅ Marquer comme lu</button>
                  ` : ''}
                  ${currentBox === 'in' ? `
                    <button class="btn sm" data-reply="${esc(m.email)}" data-subject="RE: ${esc(m.sujet)}">↩️ Répondre</button>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `;

        listEl.querySelectorAll('[data-mark]').forEach(b => {
          b.addEventListener('click', async () => {
            await API.put(`/admin/contact-messages/${b.dataset.mark}/read`, {});
            loadMessages();
          });
        });

        listEl.querySelectorAll('[data-reply]').forEach(b => {
          b.addEventListener('click', () => openComposeModal(b.dataset.reply, b.dataset.subject));
        });

      } catch (err) {
        listEl.innerHTML = `<div class="empty" style="color:var(--rouge);">Erreur : ${esc(err.message)}</div>`;
      }
    }

    c.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
        <h2 style="margin:0;">📬 Messagerie</h2>
        <button class="btn" id="btn-compose">✍️ Nouveau message</button>
      </div>

      <div class="admin-tabs-bar" style="margin-bottom:20px;">
        <button class="admin-tab-btn active" data-box="in">📥 Boîte de réception</button>
        <button class="admin-tab-btn" data-box="out">📤 Messages envoyés</button>
      </div>

      <div id="contact-list"></div>

      <div id="compose-overlay" class="withdrawal-overlay" style="display:none;">
        <div class="withdrawal-modal glass">
          <div class="wd-header">
            <h2>✍️ Nouveau message</h2>
            <button class="wd-close" id="compose-close">✕</button>
          </div>
          <div class="wd-field">
            <label>Destinataire (Email de l'utilisateur)</label>
            <input type="email" class="input" id="compose-email" placeholder="user@example.com">
          </div>
          <div class="wd-field">
            <label>Sujet</label>
            <input type="text" class="input" id="compose-subject" placeholder="Objet du message">
          </div>
          <div class="wd-field">
            <label>Message</label>
            <textarea class="input" id="compose-message" rows="5" placeholder="Votre message..."></textarea>
          </div>
          <div class="wd-actions">
            <button class="btn ghost" id="compose-cancel">Annuler</button>
            <button class="btn" id="compose-send">Envoyer</button>
          </div>
        </div>
      </div>
    `;

    c.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        c.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentBox = btn.dataset.box;
        loadMessages();
      });
    });

    const overlay = document.getElementById('compose-overlay');
    const closeModal = () => { overlay.style.display = 'none'; };

    function openComposeModal(email = '', subject = '') {
      document.getElementById('compose-email').value = email;
      document.getElementById('compose-subject').value = subject;
      document.getElementById('compose-message').value = '';
      overlay.style.display = 'flex';
    }

    document.getElementById('btn-compose').addEventListener('click', () => openComposeModal());
    document.getElementById('compose-close').addEventListener('click', closeModal);
    document.getElementById('compose-cancel').addEventListener('click', closeModal);

    document.getElementById('compose-send').addEventListener('click', async () => {
      const email = document.getElementById('compose-email').value.trim();
      const sujet = document.getElementById('compose-subject').value.trim();
      const message = document.getElementById('compose-message').value.trim();
      const btn = document.getElementById('compose-send');

      if (!email || !message) return UI.toast('Email et message requis', 'warn');

      btn.disabled = true; btn.textContent = 'Envoi...';
      try {
        await API.post('/admin/contact-messages/send', { email, sujet, message });
        UI.toast('✅ Message envoyé', 'success');
        closeModal();
        if (currentBox === 'out') loadMessages();
      } catch (err) {
        UI.toast('❌ ' + (err.data?.error || err.message), 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Envoyer';
      }
    });

    loadMessages();
  }

  /* ═══════════════ 16. SUPPRESSIONS ═══════════════ */
  async function tabDeletion(c) {
    const list = await safeGet('/admin/deletion-requests', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🗑️ Demandes de suppression (RGPD)</h2>
      ${list.length === 0 ? '<div class="empty">Aucune demande</div>' :
        `<div class="admin-list">
          ${list.map(d => `
            <div class="admin-item">
              <div>
                <strong>${esc(d.user_email)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  Statut : ${esc(d.statut)} · ${fmtDate(d.date)}
                </div>
              </div>
              ${d.statut === 'pending' ? `
                <div style="display:flex;gap:6px;">
                  <button class="btn ghost sm" data-del-approve="${d.id}">✅ Approuver</button>
                  <button class="btn ghost sm" data-del-reject="${d.id}">❌ Rejeter</button>
                </div>` : ''}
            </div>`).join('')}
        </div>`}`;

    c.querySelectorAll('[data-del-approve]').forEach(b =>
      b.addEventListener('click', async () => {
        const ok = await UI.confirm(
          '⚠️ Suppression définitive du compte ?<br>Toutes les données seront effacées.<br><br>' +
          '<small>Note : le backend refuse si le solde est positif.</small>',
          'Suppression', { html: true, danger: true, confirmText: 'Supprimer' });
        if (!ok) return;
        const r = await safePost(`/admin/deletion-requests/${b.dataset.delApprove}/approve`, {});
        if (r) { UI.toast('✅ Compte supprimé', 'success'); renderTab('deletion'); }
      }));

    c.querySelectorAll('[data-del-reject]').forEach(b =>
      b.addEventListener('click', async () => {
        const r = await safePost(`/admin/deletion-requests/${b.dataset.delReject}/reject`, {});
        if (r) { UI.toast('Demande rejetée', 'info'); renderTab('deletion'); }
      }));
  }

  /* ═══════════════ 17. API KEYS (v6.2.3) ═══════════════ */
  async function tabApiKeys(c) {
    const k = await safeGet('/admin/api-keys', {});
    const aiProviders = (window.APP && window.APP.AI_PROVIDERS) || {
      openai:    { label: 'OpenAI (GPT-4o)' },
      deepseek:  { label: 'DeepSeek' },
      anthropic: { label: 'Anthropic (Claude)' }
    };
    const oddsProviders = (window.APP && window.APP.ODDS_PROVIDERS) || {
      theodds: { label: 'The Odds API' }
    };
    const activeAi = k.active_ai_provider || 'openai';

    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🔐 Clés API</h2>
      <p style="color:var(--txt-dim);margin-bottom:24px;">
        Les clés existantes sont <strong>sécurisées</strong>.
        Laissez le champ vide pour conserver la clé actuelle. Saisissez une nouvelle valeur pour la remplacer.
      </p>

      <div class="api-section">
        <h3 style="margin-bottom:14px;">🤖 Fournisseur IA actif</h3>
        <div class="admin-field">
          <label>Fournisseur par défaut</label>
          <select class="input" id="active-ai">
            ${Object.entries(aiProviders).map(([key, p]) => `
              <option value="${key}" ${activeAi === key ? 'selected' : ''}>
                ${p.label}
              </option>`).join('')}
          </select>
        </div>
        <div class="admin-form" style="margin-top:16px;">
          ${Object.entries(aiProviders).map(([key, p]) => {
            const hasKey = k[`${key}_key`] && k[`${key}_key`].trim() !== '' && !k[`${key}_key`].includes('Non');
            const displayKey = hasKey ? '••••••••••••' : 'Clé non définie…';
            return `
            <div class="admin-field">
              <label style="display:flex; justify-content:space-between; align-items:center;">
                <span>${p.label} <span style="color:var(--txt-dim);font-size:.7rem;">(${key})</span></span>
                ${hasKey 
                  ? `<span style="color:var(--vert);font-size:.75rem;font-weight:600;">✓ DÉFINIE</span>` 
                  : `<span style="color:var(--orange);font-size:.75rem;font-weight:600;">⚠ NON DÉFINIE</span>`}
              </label>
              <input type="password" class="input" data-ai-key="${key}"
                     placeholder="${displayKey}"
                     autocomplete="new-password">
            </div>`;
          }).join('')}
        </div>
      </div>

      <div class="api-section" style="margin-top:28px;">
        <h3 style="margin-bottom:14px;">📊 Fournisseur de cotes</h3>
        <div class="admin-form">
          ${Object.entries(oddsProviders).map(([key, p]) => {
            const hasKey = k[`${key}_key`] && k[`${key}_key`].trim() !== '' && !k[`${key}_key`].includes('Non');
            const displayKey = hasKey ? '••••••••••••' : 'Clé non définie…';
            return `
            <div class="admin-field">
              <label style="display:flex; justify-content:space-between; align-items:center;">
                <span>${p.label} <span style="color:var(--txt-dim);font-size:.7rem;">(${key})</span></span>
                ${hasKey 
                  ? `<span style="color:var(--vert);font-size:.75rem;font-weight:600;">✓ DÉFINIE</span>` 
                  : `<span style="color:var(--orange);font-size:.75rem;font-weight:600;">⚠ NON DÉFINIE</span>`}
              </label>
              <input type="password" class="input" data-odds-key="${key}"
                     placeholder="${displayKey}"
                     autocomplete="new-password">
            </div>`;
          }).join('')}
        </div>
      </div>

      <div style="text-align:right;margin-top:24px;">
        <button class="btn" id="api-keys-save">💾 Enregistrer</button>
      </div>`;

    document.getElementById('api-keys-save')?.addEventListener('click', async () => {
      const body = { active_ai_provider: document.getElementById('active-ai').value };
      let count = 0;

      c.querySelectorAll('[data-ai-key]').forEach(inp => {
        const val = inp.value.trim();
        if (val && !val.includes('•')) { 
          body[`${inp.dataset.aiKey}_key`] = val; 
          count++;
        }
      });
      c.querySelectorAll('[data-odds-key]').forEach(inp => {
        const val = inp.value.trim();
        if (val && !val.includes('•')) { 
          body[`${inp.dataset.oddsKey}_key`] = val; 
          count++;
        }
      });

      const btn = document.getElementById('api-keys-save');
      btn.disabled = true;
      btn.textContent = 'Enregistrement...';

      try {
        await API.post('/admin/api-keys', body);
        
        if (count > 0) {
          UI.toast(`✅ ${count} clé(s) enregistrée(s) avec succès`, 'success');
        } else {
          UI.toast('ℹ️ Aucune nouvelle clé saisie (clés existantes conservées)', 'info');
        }
        renderTab('api-keys'); // Rafraîchit l'affichage pour montrer les badges à jour
      } catch (e) {
        UI.toast('❌ ' + (e.data?.error || e.message), 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = '💾 Enregistrer';
      }
    });
  }

  /* ═══════════════ 18. PROPOSITIONS ═══════════════ */
  async function tabPropositions(c) {
    const list = await safeGet('/admin/propositions', []);
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">📋 Propositions</h2>
      ${list.length === 0 ? '<div class="empty">Aucune proposition.</div>' :
        `<div class="admin-list">
          ${list.map(p => `
            <div class="admin-item">
              <div>
                <strong>${esc(p.user_email)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  ${fmtDate(p.date)}
                </div>
                <pre style="font-size:.75rem;color:var(--txt-dim);margin-top:6px;white-space:pre-wrap;">${esc(JSON.stringify(p.data, null, 2))}</pre>
              </div>
            </div>`).join('')}
        </div>`}`;
  }

  /* ═══════════════ 19. SAISIES EN ATTENTE ═══════════════ */
  async function tabSaisies(c) {
    const r = await safeGet('/admin/saisies?statut=pending', { saisies: [] });
    const list = r.saisies || [];

    c.innerHTML = `
      <h2 style="margin-bottom:16px;">📝 Saisies en attente de résultat</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        Cliquez sur W1 / X / W2 pour valider le résultat. Le gain net (après marge 6%) sera crédité automatiquement.
      </p>
      ${list.length === 0 ? '<div class="empty">Aucune saisie en attente.</div>' : `
        <div class="admin-list">
          ${list.map(s => `
            <div class="admin-item">
              <div style="flex:1;">
                <strong>${esc(s.user_email)}</strong>
                <div style="font-size:.85rem;color:var(--txt-dim);">
                  ${esc(s.equipe1)} vs ${esc(s.equipe2)}
                  · T${s.tableauChoisi}
                  · Mise ${fmt(s.miseDebitee)} XAF
                  · ${esc(s.date)}
                </div>
                <div style="font-size:.75rem;color:var(--txt-dim);margin-top:4px;">
                  Cotes : W1=${esc(s.cotes?.['1'])} · X=${esc(s.cotes?.['N'])} · W2=${esc(s.cotes?.['2'])}
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn ghost sm" data-statut="1" data-sid="${s.saisie_id}" data-idx="${s.idx}" style="color:var(--vert);">W1</button>
                <button class="btn ghost sm" data-statut="N" data-sid="${s.saisie_id}" data-idx="${s.idx}" style="color:var(--orange);">X</button>
                <button class="btn ghost sm" data-statut="2" data-sid="${s.saisie_id}" data-idx="${s.idx}" style="color:var(--rouge);">W2</button>
              </div>
            </div>
          `).join('')}
        </div>`}`;

    c.querySelectorAll('[data-statut]').forEach(b => {
      b.addEventListener('click', async () => {
        const statut = b.dataset.statut;
        const label = statut === '1' ? 'W1 (domicile)' : statut === 'N' ? 'X (nul)' : 'W2 (extérieur)';
        const ok = await UI.confirm(`Valider le résultat <strong>${label}</strong> ?<br><br>Le gain net sera crédité.`, 'Validation', { html: true });
        if (!ok) return;
        try {
          const res = await API.post(`/admin/saisies/${b.dataset.sid}/statut`, {
            idx: Number(b.dataset.idx), statut
          });
          UI.toast(`✅ Gain crédité : ${fmt(res.gain)} XAF (delta ${fmt(res.delta)})`, 'success', 6000);
          tabSaisies(c);
        } catch (e) {
          UI.toast('❌ ' + (e.data?.error || e.message), 'error');
        }
      });
    });
  }

  /* ═══════════════ 20. VALIDATION IA ═══════════════ */
  async function tabIaValidation(c) {
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🤖 Validation IA</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        La validation IA automatique s'effectue via le règlement automatique
        (<code>auto-settlement.js</code>) qui interroge Sportradar et OddsPapi toutes les 5 minutes.
        Utilisez le bouton ci-dessous pour relancer manuellement un match spécifique.
      </p>
      <div class="admin-form">
        <div class="admin-field">
          <label>Identifiant externe (external_id)</label>
          <input type="text" class="input" id="ia-val-external" placeholder="sr:sport_event:...">
        </div>
        <div style="text-align:right;">
          <button class="btn" id="ia-val-run">🔄 Relancer le règlement</button>
        </div>
      </div>`;

    document.getElementById('ia-val-run')?.addEventListener('click', async () => {
      const externalId = document.getElementById('ia-val-external').value.trim();
      if (!externalId) return UI.toast('external_id requis', 'warn');
      try {
        const r = await API.post(`/admin/settlement/retry/${encodeURIComponent(externalId)}`, {});
        UI.toast(`✅ ${r.message}`, 'success', 8000);
      } catch (e) { UI.toast('❌ ' + (e.data?.error || e.message), 'error'); }
    });
  }

  /* ═══════════════ 21. COTES IA ═══════════════ */
  async function tabIaOdds(c) {
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🎯 Cotes IA</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        Les cotes IA sont générées automatiquement lors de la synchronisation Sportradar.
        Utilisez le bouton ci-dessous pour lancer une synchronisation manuelle.
      </p>
      <div style="text-align:center;margin-top:20px;">
        <button class="btn btn-lg" id="ia-odds-sync">⚡ Synchroniser Sportradar</button>
      </div>`;

    document.getElementById('ia-odds-sync')?.addEventListener('click', async () => {
      try {
        const r = await API.post('/admin/matches/sync-sportradar', {});
        UI.toast(`✅ ${r.message}`, 'success', 8000);
      } catch (e) { UI.toast('❌ ' + (e.data?.error || e.message), 'error'); }
    });
  }

    /* ═══════════════ 22. PARAMÈTRES ═══════════════ */
  async function tabSettings(c) {
    c.innerHTML = '<div class="empty"><span class="spinner"></span> Chargement…</div>';

    /* Paramètres par défaut proposés si la table est vide */
    const DEFAULTS = {
      company_name:      'Me2/3Legend',
      company_email:     'support@me23legend.app',
      company_phone:     '+237 673 22 89 28',
      company_address:   'Yaoundé, Cameroun',
      company_website:   'https://me-inelect-online.cm',
      support_whatsapp:  '+237 673 22 89 28',
      support_telegram:  '@me2sur3legend',
      payment_provider:  'CinetPay',
      currency_default:  'XAF'
    };

    const settings = await safeGet('/admin/company-settings', null);

    /* Cas 1 : erreur de chargement */
    if (settings === null) {
      c.innerHTML = `
        <h2 style="margin-bottom:16px;">🏢 Paramètres de l'entreprise</h2>
        <div class="glass" style="padding:24px;border-left:4px solid var(--rouge);">
          <strong style="color:var(--rouge);">❌ Impossible de charger les paramètres.</strong>
          <p style="color:var(--txt-dim);font-size:.85rem;margin-top:8px;">
            Vérifiez que la table <code>company_settings</code> existe (migration SQL exécutée)
            et que le serveur est démarré. Regardez la console (F12) pour le détail de l'erreur.
          </p>
          <button class="btn ghost sm" id="settings-retry" style="margin-top:12px;">🔄 Réessayer</button>
        </div>`;
      document.getElementById('settings-retry')?.addEventListener('click', () => tabSettings(c));
      return;
    }

    const entries = Object.entries(settings);
    const isEmpty = entries.length === 0;

    /* Cas 2 : table vide → proposer les valeurs par défaut */
    if (isEmpty) {
      c.innerHTML = `
        <h2 style="margin-bottom:16px;">🏢 Paramètres de l'entreprise</h2>
        <div class="glass" style="padding:24px;border-left:4px solid var(--orange);">
          <strong style="color:var(--orange);">⚠️ Aucun paramètre configuré.</strong>
          <p style="color:var(--txt-dim);font-size:.85rem;margin-top:8px;">
            La table <code>company_settings</code> est vide (ou ne contient que les clés API,
            qui sont gérées dans l'onglet <strong>🔐 API Keys</strong>).
          </p>
          <p style="color:var(--txt-dim);font-size:.85rem;margin-top:8px;">
            Cliquez sur le bouton ci-dessous pour créer les paramètres par défaut,
            puis modifiez-les selon vos besoins.
          </p>
          <button class="btn" id="settings-create-defaults" style="margin-top:16px;">
            ➕ Créer les paramètres par défaut
          </button>
        </div>`;

      document.getElementById('settings-create-defaults')?.addEventListener('click', async () => {
        try {
          await UI.withLoader(async () => {
            await API.put('/admin/company-settings', DEFAULTS);
          });
          UI.toast('✅ Paramètres par défaut créés', 'success');
          tabSettings(c);
        } catch (e) {
          UI.toast('❌ ' + (e.data?.error || e.message), 'error');
        }
      });
      return;
    }

    /* Cas 3 : paramètres existants → afficher les champs */
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🏢 Paramètres de l'entreprise</h2>
      <p style="color:var(--txt-dim);margin-bottom:20px;">
        ${entries.length} paramètre(s) configuré(s). Modifiez les valeurs puis cliquez sur Enregistrer.
      </p>
      <div class="admin-form">
        ${entries.map(([key, value]) => `
          <div class="admin-field">
            <label>
              ${esc(key)}
              <span style="color:var(--txt-dim);font-size:.7rem;font-weight:400;">
                (${typeof value})
              </span>
            </label>
            <input type="text" class="input"
                   data-setting="${esc(key)}"
                   value="${esc(String(value ?? ''))}"
                   placeholder="Valeur…">
          </div>`).join('')}
        <div style="text-align:right;margin-top:20px;">
          <button class="btn" id="settings-save">💾 Enregistrer</button>
        </div>
      </div>`;

    document.getElementById('settings-save')?.addEventListener('click', async () => {
      const body = {};
      c.querySelectorAll('[data-setting]').forEach(inp => {
        body[inp.dataset.setting] = inp.value;
      });

      if (Object.keys(body).length === 0) {
        return UI.toast('Aucun champ à enregistrer', 'warn');
      }

      try {
        await UI.withLoader(async () => {
          await API.put('/admin/company-settings', body);
        });
        UI.toast(`✅ ${Object.keys(body).length} paramètre(s) enregistré(s)`, 'success');
      } catch (e) {
        UI.toast('❌ ' + (e.data?.error || e.message), 'error');
      }
    });
  }

  /* ═══════════════ 23. SÉCURITÉ ═══════════════ */
  async function tabSecurity(c) {
    c.innerHTML = `
      <h2 style="margin-bottom:16px;">🔒 Sécurité</h2>
      <div class="glass" style="padding:24px;">
        <h3 style="margin-bottom:14px;">🔑 Réinitialiser un mot de passe</h3>
        <p style="color:var(--txt-dim);font-size:.85rem;margin-bottom:16px;">
          Envoyez un lien de réinitialisation à l'utilisateur. Le lien expire dans 1 heure.
        </p>
        <div class="admin-field" style="margin-bottom:16px;">
          <label>Email de l'utilisateur</label>
          <input type="text" class="input" id="sec-reset-email" placeholder="user@example.com">
        </div>
        <div style="text-align:right;">
          <button class="btn" id="sec-reset-btn">📧 Envoyer le lien</button>
        </div>
      </div>

      <div class="glass" style="padding:24px;margin-top:20px;">
        <h3 style="margin-bottom:14px;color:var(--rouge);">⚠️ Zone dangereuse</h3>
        <p style="color:var(--txt-dim);font-size:.85rem;margin-bottom:16px;">
          Réinitialisation complète des données applicatives (utilisateurs, saisies, transactions conservés, mais compteurs remis à zéro).
          <strong style="color:var(--rouge);">Action irréversible.</strong>
        </p>
        <div style="text-align:right;">
          <button class="btn" id="sec-reset-data" style="background:linear-gradient(135deg,#ef4444,#f59e0b);">
            🗑️ Réinitialiser les données
          </button>
        </div>
      </div>`;

    document.getElementById('sec-reset-btn')?.addEventListener('click', async () => {
      const email = document.getElementById('sec-reset-email').value.trim();
      if (!email) return UI.toast('Email requis', 'warn');
      try {
        await API.post('/auth/forgot-password', { email });
        UI.toast('📧 Lien envoyé (si le compte existe)', 'success');
      } catch (e) { UI.toast('❌ ' + e.message, 'error'); }
    });

    document.getElementById('sec-reset-data')?.addEventListener('click', async () => {
      const v = await uiPrompt({
        title: '⚠️ Réinitialisation',
        message: 'Tapez "RESET" pour confirmer la réinitialisation complète des données.',
        placeholder: 'RESET',
        expectedValue: 'RESET',
        danger: true,
        confirmText: 'Réinitialiser'
      });
      if (v !== 'RESET') return;
      try {
        await API.post('/admin/reset-data', { confirm: 'RESET' });
        UI.toast('✅ Données réinitialisées', 'success');
      } catch (e) { UI.toast('❌ ' + (e.data?.error || e.message), 'error'); }
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* EXPORT + ENREGISTREMENT DANS LA NAVIGATION                     */
  /* ═══════════════════════════════════════════════════════════════ */
  window.AdminPanel = { render, renderTab };

  /* ⭐ Enregistrement de la vue "admin" auprès du routeur */
  Navigation.register('admin', render);

})();