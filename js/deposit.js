// C:\Me\AppMoney\MeParisPortifs\js\deposit.js
// ═══════════════════════════════════════════════════════════════════
// v6.1.0 - Interface épurée (masquage des frais pour l'utilisateur)
// ═══════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const state = {
    open: false,
    methode: 'mobile_money',
    devise: 'XAF'
  };

  const fmt = (v, d = 0) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });

  const DEVISES_TO_XAF = {
    XAF: 1, XOF: 1, EUR: 655.957, USD: 601.80, GBP: 762.70, CHF: 676.20,
    CAD: 443.20, JPY: 4.024, AUD: 395.20, CNY: 83.56, BRL: 120.36,
    MAD: 60.46, DZD: 4.492, TND: 191.80, RUB: 6.66
  };

  const METHOD_LABELS = {
    mobile_money: { icon: '📱', label: 'Mobile Money', canal: 'MTN / Orange' }
    // Carte et virement masqués
  };

  function open() {
    if (!window.CURRENT_USER) return UI.toast('Veuillez vous connecter', 'warn');
    if (window.CURRENT_USER.role === 'admin') return UI.toast("L'admin ne peut pas déposer.", 'warn');
    if (!window.CURRENT_PERMS?.can_deposer) return UI.toast("Permission de dépôt désactivée.", 'error');

    state.open = true;
    state.devise = window.CURRENT_USER.devise || 'XAF';
    render();
  }

  function close() {
    state.open = false;
    const el = document.getElementById('deposit-overlay');
    if (el) el.remove();
  }

  function convertToXAF(montant, devise) {
    const taux = DEVISES_TO_XAF[devise] || 1;
    return Math.round(Number(montant) * taux);
  }

  function render() {
    let ov = document.getElementById('deposit-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'deposit-overlay';
      ov.className = 'withdrawal-overlay';
      document.body.appendChild(ov);
    }

    const devises = window.APP.listDevises().map(d =>
      `<option value="${d.code}" ${state.devise === d.code ? 'selected' : ''}>
        ${d.drapeau} ${d.code} — ${d.nom}
      </option>`
    ).join('');

    const methodes = Object.entries(METHOD_LABELS).map(([key, m]) =>
      `<option value="${key}" ${state.methode === key ? 'selected' : ''}>
        ${m.icon} ${m.label} — ${m.canal}
      </option>`
    ).join('');

    ov.innerHTML = `
      <div class="withdrawal-modal glass" style="background:#0a0a14; border:1px solid rgba(124,58,237,.4); max-width:520px;">
        <div class="wd-header">
          <h2>💰 Dépôt de fonds</h2>
          <button class="wd-close" onclick="Deposit.close()">✕</button>
        </div>

        <div class="wd-field">
          <label>Devise</label>
          <select class="input" id="dep-devise" style="background:rgba(10,10,25,.8); color:#fff;">${devises}</select>
        </div>

        <div class="wd-field">
          <label>Méthode de paiement</label>
          <select class="input" id="dep-methode" style="background:rgba(10,10,25,.8); color:#fff;">${methodes}</select>
        </div>

        <div class="wd-field">
          <label>Montant à envoyer (<span id="lbl-devise">${state.devise}</span>)</label>
          <input type="number" class="input" id="dep-amount" placeholder="Ex: 5000" min="500" step="100" style="background:rgba(10,10,25,.8); color:#fff;">
        </div>

        <div class="dep-quick-amounts" id="dep-quick">
          ${[1000, 5000, 10000, 25000, 50000].map(v => `
            <button class="dep-quick-btn" data-amount="${v}">${fmt(v)}</button>
          `).join('')}
        </div>

        <!-- Affichage simplifié pour l'utilisateur (pas de frais) -->
        <div class="dep-preview" id="dep-preview" style="display:none; flex-direction:column; align-items:stretch; gap:8px; background:rgba(34,211,238,.1); border-left:3px solid var(--cyan);">
          <div id="dep-conversion-row" style="display:none; padding:8px 12px; font-size:.82rem; margin-bottom:8px;">
            <span style="color:var(--txt-dim);">Conversion :</span>
            <strong id="preview-conversion" style="color:var(--cyan);"></strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span class="dep-preview-label" style="color:var(--cyan); font-weight:700;">Montant à payer :</span>
            <strong id="preview-brut" style="color:var(--cyan); font-size:1.2rem;">0 ${state.devise}</strong>
          </div>
        </div>

        <div class="wd-actions" style="margin-top:20px;">
          <button class="btn ghost" onclick="Deposit.close()">Annuler</button>
          <button class="btn" id="dep-submit">💳 Payer avec CinetPay</button>
        </div>
      </div>`;

    bindEvents();
  }

  function updatePreview() {
    const amountInput = document.getElementById('dep-amount');
    const preview = document.getElementById('dep-preview');
    if (!amountInput || !preview) return;

    const montant = Number(amountInput.value);
    if (!montant || montant <= 0) {
      preview.style.display = 'none';
      return;
    }

    const taux = DEVISES_TO_XAF[state.devise] || 1;
    const montantXAF = Math.round(montant * taux);

    preview.style.display = 'flex';

    const convRow = document.getElementById('dep-conversion-row');
    if (state.devise !== 'XAF' && state.devise !== 'XOF') {
      convRow.style.display = 'block';
      document.getElementById('preview-conversion').textContent =
        `${fmt(montant)} ${state.devise} → ${fmt(montantXAF)} XAF`;
    } else {
      convRow.style.display = 'none';
    }

    // On affiche uniquement ce que l'utilisateur paie, sans mentionner les frais
    document.getElementById('preview-brut').textContent = `${fmt(montantXAF)} XAF`;
  }

  function bindEvents() {
    const amountInput = document.getElementById('dep-amount');
    if (amountInput) {
      setTimeout(() => amountInput.focus(), 100);
      amountInput.addEventListener('input', updatePreview);
      amountInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitDeposit(); });
    }

    document.getElementById('dep-devise')?.addEventListener('change', e => {
      state.devise = e.target.value;
      document.getElementById('lbl-devise').textContent = state.devise;
      updatePreview();
    });

    document.getElementById('dep-methode')?.addEventListener('change', e => {
      state.methode = e.target.value;
    });

    document.querySelectorAll('.dep-quick-btn').forEach(b => {
      b.addEventListener('click', () => {
        const inp = document.getElementById('dep-amount');
        if (inp) { inp.value = b.dataset.amount; updatePreview(); }
      });
    });

    document.getElementById('dep-submit')?.addEventListener('click', submitDeposit);
  }

  async function submitDeposit() {
    const amountInput = document.getElementById('dep-amount');
    const submitBtn = document.getElementById('dep-submit');
    if (!amountInput || !submitBtn) return;

    const montant = Number(amountInput.value);
    if (!montant || montant < 500) {
      return UI.toast('Montant minimum : 500', 'warn');
    }

    const taux = DEVISES_TO_XAF[state.devise] || 1;
    const montantXAF = Math.round(montant * taux);

    if (montantXAF < 500) {
      return UI.toast(`Après conversion, ${montantXAF} XAF < minimum 500 XAF.`, 'warn');
    }

    const convMsg = (state.devise !== 'XAF' && state.devise !== 'XOF')
      ? `<br><small style="color:var(--cyan);">${fmt(montant)} ${state.devise} = ${fmt(montantXAF)} XAF</small>`
      : '';

    const ok = await UI.confirm(
      `Vous allez être redirigé vers <strong>CinetPay</strong> pour payer :<br><br>` +
      `<strong>${fmt(montantXAF)} XAF</strong>${convMsg}`,
      '💰 Confirmation du dépôt', { html: true }
    );
    if (!ok) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Redirection…';

    try {
            const r = await API.post('/payment/initialize', {
        amount: montant,
        methode: state.methode,
        devise: state.devise
      });

      if (r.payment_url) {
        /* ⭐ v6.2.7 : passage par une page de transition */
        sessionStorage.setItem('payment-redirect-url', r.payment_url);
        sessionStorage.setItem('payment-transaction-id', r.transaction_id || '');
        sessionStorage.setItem('payment-context', 'deposit');
        window.location.href = '/payment-transition';
      } else {
        throw new Error(r.error || 'URL introuvable');
      }
    } catch (e) {
      UI.toast('❌ ' + (e.data?.error || e.message), 'error', 7000);
      submitBtn.disabled = false;
      submitBtn.textContent = '💳 Payer avec CinetPay';
    }
  }

  window.Deposit = { open, close };
})();