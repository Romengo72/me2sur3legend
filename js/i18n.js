// C:\Me\AppMoney\MeParisPortifs\js\i18n.js
window.I18N = (() => {
  'use strict';

  const STORAGE_KEY = 'me23_lang';
  const DEFAULT_LANG = 'fr';

  const LANGS = {
    fr: { label: 'Français',  flag: 'https://flagcdn.com/w20/fr.png' },
    en: { label: 'English',   flag: 'https://flagcdn.com/w20/gb.png' },
    ru: { label: 'Русский',   flag: 'https://flagcdn.com/w20/ru.png' },
    zh: { label: '中文',      flag: 'https://flagcdn.com/w20/cn.png' }
  };

  const STRINGS = {
    // Navigation
    'nav.saisie':       { fr: 'Saisie',      en: 'Entry',        ru: 'Ставка',       zh: '输入' },
    'nav.results':      { fr: 'Résultats',   en: 'Results',      ru: 'Результаты',   zh: '结果' },
    'nav.history':      { fr: 'Historique',  en: 'History',      ru: 'История',      zh: '历史' },
    'nav.stats':        { fr: 'Statistiques',en: 'Statistics',   ru: 'Статистика',   zh: '统计' },
    'nav.suggestions':  { fr: 'Suggestions', en: 'Suggestions',  ru: 'Подсказки',    zh: '建议' },
    'nav.leaderboard':  { fr: 'Classement',  en: 'Leaderboard',  ru: 'Рейтинг',      zh: '排名' },
    'nav.subscription': { fr: 'Abonnement',  en: 'Subscription', ru: 'Подписка',     zh: '订阅' },
    'nav.referral':     { fr: 'Parrainage',  en: 'Referral',     ru: 'Рефералы',     zh: '推荐' },
    'nav.news':         { fr: 'Actualités',  en: 'News',         ru: 'Новости',      zh: '新闻' },
    'nav.profile':      { fr: 'Mon profil',  en: 'My profile',   ru: 'Профиль',      zh: '我的资料' },
    'nav.admin':        { fr: 'Admin',       en: 'Admin',        ru: 'Админ',        zh: '管理' },

    // Boutons & Interface
    'app.balance':       { fr: 'Mon solde', en: 'My balance', ru: 'Мой баланс', zh: '我的余额' },
    'app.bf_balance':    { fr: 'Budget Fonctionnement', en: 'Operating Budget', ru: 'Операционный бюджет', zh: '运营预算' },
    'app.deposit':       { fr: 'Dépôt', en: 'Deposit', ru: 'Депозит', zh: '充值' },
    'app.withdraw':      { fr: 'Retrait sécurisé', en: 'Withdraw', ru: 'Безопасный вывод', zh: '安全提款' },
    'app.collect':       { fr: 'Collecte des fonds', en: 'Collect funds', ru: 'Сбор средств', zh: '筹集资金' },
    
    'btn.save':         { fr: 'Enregistrer', en: 'Save',         ru: 'Сохранить',    zh: '保存' },
    'btn.cancel':       { fr: 'Annuler',     en: 'Cancel',       ru: 'Отмена',       zh: '取消' },
    'btn.close':        { fr: 'Fermer',      en: 'Close',        ru: 'Закрыть',      zh: '关闭' },
    'btn.logout':       { fr: 'Déconnexion', en: 'Logout',       ru: 'Выход',        zh: '登出' },
    'btn.theme':        { fr: 'Thème clair', en: 'Light theme',  ru: 'Светлая тема', zh: '浅色主题' },

    // Saisie
    'saisie.add_match': { fr: 'Ajouter un match', en: 'Add match', ru: 'Добавить матч', zh: '添加比赛' },
    'saisie.validate':  { fr: 'Valider la saisie', en: 'Validate entry', ru: 'Подтвердить', zh: '确认' },
    'saisie.team1':     { fr: 'Équipe 1 (domicile)', en: 'Team 1 (home)', ru: 'Команда 1', zh: '主队' },
    'saisie.team2':     { fr: 'Équipe 2 (extérieur)', en: 'Team 2 (away)', ru: 'Команда 2', zh: '客队' },
    'saisie.multiplier':{ fr: 'Multiplicateur', en: 'Multiplier', ru: 'Множитель', zh: '倍数' },
    'saisie.budget_total': { fr: 'Budget total', en: 'Total budget', ru: 'Общий бюджет', zh: '总预算' },
    'saisie.odds_required':{ fr: 'Renseignez les 3 cotes pour voir le calcul', en: 'Fill in the 3 odds to see the calculation', ru: 'Введите 3 коэффициента', zh: '输入3个赔率' },

    // Landing Page
    'landing.nav.features': { fr: 'Fonctionnalités', en: 'Features', ru: 'Функции', zh: '功能' },
    'landing.nav.how':      { fr: 'Comment ça marche', en: 'How it works', ru: 'Как это работает', zh: '运作方式' },
    'landing.nav.pricing':  { fr: 'Tarifs', en: 'Pricing', ru: 'Цены', zh: '价格' },
    'landing.nav.leaderboard': { fr: 'Classement', en: 'Leaderboard', ru: 'Рейтинг', zh: '排名' },
    'landing.nav.news':     { fr: 'Actualités', en: 'News', ru: 'Новости', zh: '新闻' },
    'landing.nav.faq':      { fr: 'FAQ', en: 'FAQ', ru: 'Вопросы', zh: '常见问题' },
    'landing.nav.login':    { fr: 'Se connecter', en: 'Login', ru: 'Войти', zh: '登录' },
    'landing.nav.start':    { fr: 'Commencer', en: 'Start', ru: 'Начать', zh: '开始' },

    'landing.hero.badge':   { fr: '✨ Nouveau : Prédictions IA', en: '✨ New: AI Predictions', ru: '✨ Новое: ИИ Прогнозы', zh: '✨ 新功能：AI预测' },
    'landing.hero.title1':  { fr: 'Paris sportifs', en: 'Smart', ru: 'Умные', zh: '智能' },
    'landing.hero.title2':  { fr: 'intelligents', en: 'sports betting', ru: 'ставки на спорт', zh: '体育博彩' },
    'landing.hero.sub':     { 
      fr: 'Calculez vos mises optimales sur 3 cotes (W1, X, W2) avec 2 gagnants sur 3 garantis dès que la plus petite cote atteint 1.60. Simple. Précis. Gagnant.', 
      en: 'Calculate optimal stakes on 3 odds (W1, X, W2) with 2 out of 3 guaranteed as soon as the lowest odds reach 1.60. Simple. Precise. Winning.', 
      ru: 'Рассчитайте оптимальные ставки на 3 коэффициента (W1, X, W2) с гарантией 2 из 3, как только самый низкий коэффициент достигнет 1.60. Просто. Точно. Выигрышно.', 
      zh: '计算3个赔率（W1、X、W2）的最佳投注，只要最低赔率达到1.60，即可保证3中2。简单。精准。赢家。' 
    },
    'landing.hero.cta1':    { fr: '🚀 Commencer gratuitement', en: '🚀 Start for free', ru: '🚀 Начать бесплатно', zh: '🚀 免费开始' },
    'landing.hero.cta2':    { fr: '▶️ Voir la démo', en: '▶️ See demo', ru: '▶️ Смотреть демо', zh: '▶️ 查看演示' },

    'landing.features.title': { fr: 'Pourquoi Me2/3Legend ?', en: 'Why Me2/3Legend?', ru: 'Почему Me2/3Legend?', zh: '为什么选择 Me2/3Legend？' },
    'landing.features.sub': { fr: 'Une approche mathématique rigoureuse, une interface moderne, des résultats mesurables.', en: 'A rigorous mathematical approach, a modern interface, measurable results.', ru: 'Строгий математический подход, современный интерфейс, измеримые результаты.', zh: '严谨的数学方法，现代的界面，可衡量的结果。' },
    
    'landing.how.title':    { fr: 'Comment ça marche ?', en: 'How it works?', ru: 'Как это работает?', zh: '运作方式？' },
    'landing.how.sub':      { fr: '4 étapes simples pour transformer votre approche des paris.', en: '4 simple steps to transform your betting approach.', ru: '4 простых шага, чтобы изменить ваш подход к ставкам.', zh: '4个简单步骤改变您的投注方式。' },
    
    'landing.pricing.title':{ fr: 'Choisissez votre formule', en: 'Choose your plan', ru: 'Выберите свой план', zh: '选择您的方案' },
    'landing.pricing.sub':  { fr: 'Commencez gratuitement, évoluez à votre rythme.', en: 'Start for free, evolve at your own pace.', ru: 'Начните бесплатно, развивайтесь в своем темпе.', zh: '免费开始，按自己的节奏发展。' }
  };

  let currentLang = DEFAULT_LANG;

  function loadLang() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && LANGS[stored]) return stored;
    } catch (_) {}
    const navLang = (navigator.language || 'fr').slice(0, 2).toLowerCase();
    return LANGS[navLang] ? navLang : DEFAULT_LANG;
  }

  function saveLang(code) { try { localStorage.setItem(STORAGE_KEY, code); } catch (_) {} }

  function t(key, vars) {
    const entry = STRINGS[key];
    if (!entry) return key; 
    let str = entry[currentLang] || entry[DEFAULT_LANG] || key;
    if (vars) str = str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
    return str;
  }

  function setLang(code) {
    if (!LANGS[code]) return;
    currentLang = code;
    saveLang(code);
    document.documentElement.setAttribute('lang', code);
    apply();
    document.dispatchEvent(new CustomEvent('lang:change', { detail: { lang: code } }));
  }

  function getLang() { return currentLang; }
  function getLangs() { return LANGS; }

  function apply() {
    document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.getAttribute('data-i18n')));
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))));
  }

  function renderSelector(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.innerHTML = ''; 

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position: relative; display: inline-flex; align-items: center; gap: 8px; background: rgba(10,10,25,.6); border: 1px solid var(--glass-brd); border-radius: 8px; padding: 6px 12px; cursor: pointer; color: var(--txt); font-size: 0.85rem; font-family: inherit;`;

    const img = document.createElement('img');
    img.src = LANGS[currentLang].flag;
    img.style.cssText = 'width: 20px; height: auto; border-radius: 2px;';

    const txt = document.createElement('span');
    txt.textContent = LANGS[currentLang].label;

    const select = document.createElement('select');
    select.style.cssText = 'position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;';

    Object.entries(LANGS).forEach(([code, meta]) => {
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = meta.label;
      opt.selected = code === currentLang;
      select.appendChild(opt);
    });

    select.addEventListener('change', (e) => {
      const newLang = e.target.value;
      setLang(newLang);
      img.src = LANGS[newLang].flag;
      txt.textContent = LANGS[newLang].label;
    });

    wrapper.appendChild(img);
    wrapper.appendChild(txt);
    wrapper.appendChild(select);
    el.appendChild(wrapper);
  }

  function init() {
    currentLang = loadLang();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }

  init();
  return { t, setLang, getLang, getLangs, apply, renderSelector };
})();