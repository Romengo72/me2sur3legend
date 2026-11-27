// C:\Me\AppMoney\MeParisPortifs\js\withdrawal.js
// v6.2.1 — Affichage des frais + garde devCode + encodage propre
(function () {
  'use strict';

  const RETRAIT_MIN = 2000;
  const RETRAIT_MAX = 5000000;

  /* Frais par catégorie (miroir de config.js FEES.withdrawal) */
  const FRAIS_RETRAIT = {
    free:       0.050,
    premium:    0.030,
    vip:        0.025,
    legendaire: 0.025
  };

  const state = {
    step: 0,
    amount: 0,
    devise: 'XAF',
    devCode: null,
    threshold: 5000000,   /* cohérent avec RETRAIT_MAX */
    categorie: 'free'
  };

  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });

  function open() {
    if (!window.CURRENT_USER) return UI.toast('Veuillez vous connecter', 'warn');
    if (window.CURRENT_USER.role === 'admin') return UI.toast("L'admin ne peut pas retirer.", 'warn');
    if (!window.CURRENT_PERMS?.can_retirer) return UI.toast("Permission de retrait désactivée.", 'error');

    state.step = 1;
    state.categorie = window.CURRENT_USER.category || 'free';
    if (window.APP && window.APP.PAYMENT_THRESHOLD) state.threshold = window.APP.PAYMENT_THRESHOLD;
    render();
  }

  function close() {
    state.step = 0; state.amount = 0; state.devCode = null;
    const el = document.getElementById('withdrawal-overlay');
    if (el) el.remove();
  }

  function render() {
    let ov = document.getElementById('withdrawal-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'withdrawal-overlay';
      ov.className = 'withdrawal-overlay';
      document.body.appendChild(ov);
    }
    if (state.step === 1) renderStep1(ov);
    else if (state.step === 2) renderStep2(ov);
  }

  function renderStep1(ov) {
    const tauxFrais = FRAIS_RETRAIT[state.categorie] ?? FRAIS_RETRAIT.free;
    const fraisPct = (tauxFrais * 100).toFixed(1);

    ov.innerHTML = `
      <div class="withdrawal-modal glass" style="background:#0a0a14; border:1px solid rgba(124,58,237,.4);">
        <div class="wd-header">
          <h2>🔐 Retrait sécurisé</h2>
          <button class="wd-close" onclick="Withdrawal.close()">✕</button>
        </div>
        <div class="wd-step-indicator">
          <span class="wd-step active">1</span>
          <span class="wd-line"></span>
          <span class="wd-step">2</span>
        </div>
        <p class="wd-info">
          Un code de validation vous sera envoyé par email.
          <br><br>
          <small style="opacity:.85;">
            💡 Minimum : <strong>${RETRAIT_MIN.toLocaleString('fr-FR')} XAF</strong> · 1 retrait max / 24h
            <br>
            Frais de retrait : <strong>${fraisPct} %</strong> (catégorie ${state.categorie})
          </small>
        </p>
        <div class="wd-field">
          <label>Montant net à recevoir (XAF)</label>
          <input class="input" type="number" id="wd-amount" placeholder="Ex: 5000" min="${RETRAIT_MIN}" max="${RETRAIT_MAX}" step="1" style="background:rgba(10,10,25,.8); color:#fff;">
        </div>
        <div class="wd-field">
          <label>Mot de passe du compte</label>
          <input class="input" type="password" id="wd-password" placeholder="Votre mot de passe" autocomplete="current-password" style="background:rgba(10,10,25,.8); color:#fff;">
        </div>

        <div id="wd-preview" style="display:none; padding:14px 18px; background:rgba(124,58,237,.1); border-left:3px solid var(--violet); border-radius:10px; margin:14px 0;">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:var(--txt-dim);">Montant net reçu :</span>
            <strong id="wd-preview-net" style="color:var(--cyan); font-size:1.1rem;">0 XAF</strong>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
            <span style="color:var(--txt-dim);">Frais (${fraisPct} %) :</span>
            <span id="wd-preview-frais" style="color:var(--orange); font-weight:700;">0 XAF</span>
          </div>
          <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px dashed var(--glass-brd);">
            <span style="color:var(--txt-dim); font-weight:600;">Total débité :</span>
            <strong id="wd-preview-total" style="color:var(--txt); font-size:1.1rem;">0 XAF</strong>
          </div>
        </div>

        <div class="wd-actions">
          <button class="btn ghost" onclick="Withdrawal.close()">Annuler</button>
          <button class="btn" id="wd-submit-step1">Recevoir le code →</button>
        </div>
      </div>`;

    const amountEl = document.getElementById('wd-amount');
    const pwdEl = document.getElementById('wd-password');
    const previewEl = document.getElementById('wd-preview');

    if (amountEl) {
      setTimeout(() => amountEl.focus(), 100);
      amountEl.addEventListener('input', () => {
        const m = Number(amountEl.value);
        if (!m || m < RETRAIT_MIN) { previewEl.style.display = 'none'; return; }
        const frais = m * tauxFrais;
        const total = m + frais;
        document.getElementById('wd-preview-net').textContent = fmt(m) + ' XAF';
        document.getElementById('wd-preview-frais').textContent = fmt(frais) + ' XAF';
        document.getElementById('wd-preview-total').textContent = fmt(total) + ' XAF';
        previewEl.style.display = 'block';
      });
    }
    if (pwdEl) pwdEl.addEventListener('keydown', e => { if (e.key === 'Enter') submitStep1(); });
    document.getElementById('wd-submit-step1')?.addEventListener('click', submitStep1);
  }

  function renderStep2(ov) {
    const needsApproval = state.amount > state.threshold;

    ov.innerHTML = `
      <div class="withdrawal-modal glass" style="background:#0a0a14; border:1px solid rgba(124,58,237,.4);">
        <div class="wd-header">
          <h2>📧 Code de validation</h2>
          <button class="wd-close" onclick="Withdrawal.close()">✕</button>
        </div>
        <div class="wd-step-indicator">
          <span class="wd-step done">✓</span>
          <span class="wd-line done"></span>
          <span class="wd-step active">2</span>
        </div>
        <p class="wd-info">Code envoyé par email. Expire dans 10 min.</p>
        ${state.devCode ? `<div class="wd-devcode">[DEV] Code : <strong>${state.devCode}</strong></div>` : ''}
        ${needsApproval ? `<div style="padding:12px; background:rgba(245,158,11,.12); border-left:3px solid var(--orange); border-radius:10px; margin-bottom:16px; font-size:.82rem; color:var(--orange);">Validation admin requise (seuil dépassé).</div>` : ''}

        <div class="wd-field">
          <label>Code à 6 chiffres</label>
          <input class="input wd-otp-input" type="text" id="wd-code" placeholder="000000" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
        </div>

        <div class="wd-summary" style="text-align:center; font-size:1.2rem; font-weight:800; color:var(--cyan);">
          ${fmt(state.amount)} XAF
        </div>

        <div class="wd-actions">
          <button class="btn ghost" onclick="Withdrawal.back()">← Retour</button>
          <button class="btn" id="wd-submit-step2">✅ Confirmer</button>
        </div>
      </div>`;

    const codeEl = document.getElementById('wd-code');
    if (codeEl) {
      setTimeout(() => codeEl.focus(), 100);
      codeEl.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
        if (e.target.value.length === 6) submitStep2();
      });
    }
    document.getElementById('wd-submit-step2')?.addEventListener('click', submitStep2);
  }

  async function submitStep1() {
    const amountEl = document.getElementById('wd-amount');
    const pwdEl = document.getElementById('wd-password');
    const btn = document.getElementById('wd-submit-step1');
    if (!amountEl || !pwdEl || !btn) return;

    const amount = Number(amountEl.value);
    const password = pwdEl.value;

    if (!amount || amount < RETRAIT_MIN) return UI.toast(`Minimum ${RETRAIT_MIN} XAF`, 'warn');
    if (!password) return UI.toast('Mot de passe requis', 'warn');

    state.amount = amount;
    state.devise = window.CURRENT_USER?.devise || 'XAF';

    btn.disabled = true; btn.textContent = 'Envoi...';
    try {
      const r = await API.withdrawal.requestOtp(amount, state.devise, password);
      state.devCode = r.devCode || null;
      state.threshold = r.threshold || state.threshold;
      state.step = 2;
      render();
      UI.toast('📧 Code envoyé', 'success');
    } catch (e) {
      UI.toast('❌ ' + (e.data?.error || e.message), 'error', 7000);
      btn.disabled = false; btn.textContent = 'Recevoir le code →';
    }
  }

  async function submitStep2() {
    const codeEl = document.getElementById('wd-code');
    const btn = document.getElementById('wd-submit-step2');
    if (!codeEl || !btn) return;

    const code = codeEl.value.trim();
    if (!/^\d{6}$/.test(code)) return UI.toast('Code à 6 chiffres', 'warn');

    btn.disabled = true; btn.textContent = 'Validation...';
    try {
      const r = await API.withdrawal.confirm(code);
      if (r.pending === true) { UI.toast(r.message, 'info', 8000); close(); return; }
      UI.toast(r.message, 'success', 5000);
      if (window.CURRENT_USER) window.CURRENT_USER.balance = r.newBalance;
      const pill = document.getElementById('balance-pill');
      if (pill) pill.querySelector('.value').textContent = window.APP.fmt.money(r.newBalance, state.devise);
      close();
    } catch (e) {
      UI.toast('❌ ' + (e.data?.error || e.message), 'error', 5000);
      btn.disabled = false; btn.textContent = '✅ Confirmer';
      codeEl.value = ''; codeEl.focus();
    }
  }

  function back() { state.step = 1; state.devCode = null; render(); }

  window.Withdrawal = { open, close, back };
})();