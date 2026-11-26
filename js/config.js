// C:\Me\AppMoney\MeParisPortifs\js\config.js
// v6.2.8 — Seuil cohérent, catégories ASCII, log conditionnel
// ===================================================================
// NOTE : clés techniques en ASCII strict (legendaire sans accent)
//        accents uniquement dans les labels affichés

window.APP = {
  VERSION: '6.2.8',
  API_BASE: '/api',

  // ===================================================================
  // FRAIS (source de vérité unique — miroir de routes-payment.js)
  // ===================================================================
  FEES: {
    deposit: {
      mobile_money: 0.025
      // carte et virement désactivés en v6.2.8
    },
    withdrawal: {
      free:       0.050,
      premium:    0.030,
      vip:        0.025,
      legendaire: 0.025
    },
    categoryBonus: {
      free:       0,
      premium:    0.02,
      vip:        0.05,
      legendaire: 0.10
    }
  },

  // ===================================================================
  // CORRECTIF #5 : masquer virement et carte
  // ===================================================================
  PAYMENT_METHODS: {
    mobile_money: {
      enabled: true,
      label: 'Mobile Money',
      icon: '\uD83D\uDCF1',
      canal: 'MTN / Orange',
      fee: 0.025
    }
    // carte et virement désactivés
  },

  // CORRECTIF #10 : seuil de paiement global
  // ⭐ v6.2.8 : ramené à 5M XAF (cohérent avec RETRAIT_MAX)
  //    Sinon la validation admin ne se déclenche jamais
  PAYMENT_THRESHOLD: 5_000_000,

  RETRAIT_MIN: 2000,
  RETRAIT_MAX: 5_000_000,

  // CORRECTIF #9 : suspension IA sur gains successifs
  IA_WIN_THRESHOLD: {
    free:        50_000,
    premium:    100_000,
    vip:        100_000,
    legendaire: 100_000
  },
  IA_WIN_WINDOW_HOURS: 7 * 24,

  // CORRECTIF #7 : parrainage obligatoire
  REFERRAL_REQUIRED: true,

  // ===================================================================
  // CORRECTIF #1 : catégories — CLÉS ASCII STRICTES
  // ===================================================================
  CATEGORIES: {
    free:       { label: 'Simple',      icon: '\uD83D\uDC64', color: '#94a3b8', prix: 0 },
    premium:    { label: 'Premium',     icon: '\u2B50',       color: '#7c3aed', prix: 5000 },
    vip:        { label: 'VIP',         icon: '\uD83D\uDC51', color: '#f59e0b', prix: 15000 },
    legendaire: { label: 'L\u00E9gendaire', icon: '\uD83D\uDC8E', color: '#22d3ee', prix: 25000 }
  },

  // CORRECTIF #4 : langues supportées
  LANGUAGES: ['fr', 'en', 'ru', 'zh'],
  DEFAULT_LANG: 'fr',

  // ===================================================================
  // Devises
  // ===================================================================
  DEVISES: {
    XAF: { code: 'XAF', nom: 'Franc CFA',         symbole: 'FCFA', taux: 1,         drapeau: '\uD83C\uDF0D' },
    EUR: { code: 'EUR', nom: 'Euro',              symbole: '\u20AC', taux: 655.957, drapeau: '\uD83C\uDDEA\uD83C\uDDFA' },
    USD: { code: 'USD', nom: 'Dollar americain',  symbole: '$',    taux: 601.80,    drapeau: '\uD83C\uDDFA\uD83C\uDDF8' },
    GBP: { code: 'GBP', nom: 'Livre sterling',    symbole: '\u00A3', taux: 762.70,  drapeau: '\uD83C\uDDEC\uD83C\uDDE7' },
    CHF: { code: 'CHF', nom: 'Franc suisse',      symbole: 'CHF',  taux: 676.20,    drapeau: '\uD83C\uDDE8\uD83C\uDDED' },
    CAD: { code: 'CAD', nom: 'Dollar canadien',   symbole: 'C$',   taux: 443.20,    drapeau: '\uD83C\uDDE8\uD83C\uDDE6' },
    JPY: { code: 'JPY', nom: 'Yen japonais',      symbole: '\u00A5', taux: 4.024,   drapeau: '\uD83C\uDDEF\uD83C\uDDF5' },
    AUD: { code: 'AUD', nom: 'Dollar australien', symbole: 'A$',   taux: 395.20,    drapeau: '\uD83C\uDDE6\uD83C\uDDFA' },
    CNY: { code: 'CNY', nom: 'Yuan chinois',      symbole: '\u00A5', taux: 83.56,   drapeau: '\uD83C\uDDE8\uD83C\uDDF3' },
    BRL: { code: 'BRL', nom: 'Real bresilien',    symbole: 'R$',   taux: 120.36,    drapeau: '\uD83C\uDDE7\uD83C\uDDF7' },
    MAD: { code: 'MAD', nom: 'Dirham marocain',   symbole: 'DH',   taux: 60.46,     drapeau: '\uD83C\uDDF2\uD83C\uDDE6' },
    DZD: { code: 'DZD', nom: 'Dinar algerien',    symbole: 'DA',   taux: 4.492,     drapeau: '\uD83C\uDDE9\uD83C\uDDFF' },
    TND: { code: 'TND', nom: 'Dinar tunisien',    symbole: 'DT',   taux: 191.80,    drapeau: '\uD83C\uDDF9\uD83C\uDDF3' },
    RUB: { code: 'RUB', nom: 'Rouble russe',      symbole: '\u20BD', taux: 6.66,    drapeau: '\uD83C\uDDF7\uD83C\uDDFA' }
  },

  THEMES: ['dark', 'light'],
  MULTIPLICATEURS: [1, 2, 5, 10, 100],

  AI_PROVIDERS: {
    openai:    { label: 'OpenAI (GPT-4o)',    prefix: 'sk-', url: 'https://api.openai.com/v1' },
    deepseek:  { label: 'DeepSeek',           prefix: 'sk-', url: 'https://api.deepseek.com/v1' },
    anthropic: { label: 'Anthropic (Claude)', prefix: 'sk-', url: 'https://api.anthropic.com/v1' }
  },

  ODDS_PROVIDERS: {
    theodds: { label: 'The Odds API', url: 'https://api.the-odds-api.com/v4' }
  },

  _esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  getDevise(code) { return this.DEVISES[code] || this.DEVISES.XAF; },
  listDevises() {
    const keys = Object.keys(this.DEVISES);
    keys.sort((a, b) => {
      if (a === 'XAF') return -1;
      if (b === 'XAF') return 1;
      return a.localeCompare(b);
    });
    return keys.map(k => this.DEVISES[k]);
  },

  /* ⭐ v6.2.8 : helper centralisé pour le label de catégorie */
  getCategoryLabel(code) {
    return this.CATEGORIES[code]?.label || code || 'Inconnu';
  },

  toXAF(montant, deviseCode) {
    const d = this.getDevise(deviseCode);
    return Number(montant || 0) * (d.taux || 1);
  },
  fromXAF(montantXAF, deviseCode) {
    const d = this.getDevise(deviseCode);
    return Number(montantXAF || 0) / (d.taux || 1);
  },

  listActivePaymentMethods() {
    return Object.entries(this.PAYMENT_METHODS)
      .filter(([, m]) => m.enabled)
      .map(([key, m]) => ({ key, ...m }));
  },

  fmt: {
    money(montantXAF, deviseCode = 'XAF') {
      const devise = window.APP.getDevise(deviseCode);
      const valeur = Number(montantXAF || 0) / (devise.taux || 1);
      const nb = valeur.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return `${nb} ${devise.symbole}`;
    },
    date(d) {
      if (!d) return '-';
      return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
    datetime(d) {
      if (!d) return '-';
      return new Date(d).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }
  }
};

/* ⭐ v6.2.8 : log conditionnel */
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  console.log('[config] VERSION =', window.APP.VERSION, '| Devises :', Object.keys(window.APP.DEVISES).length);
}