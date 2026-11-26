// C:\Me\AppMoney\MeParisPortifs\js\api.js
// v6.2.9 — Suppression log, timeout réseau, redirection CSRF
window.API = (() => {
  'use strict';

  const base = (window.APP && window.APP.API_BASE) || '/api';
  const TIMEOUT_MS = 30000;

  function getCsrfToken() {
    const match = document.cookie.match(/(^|;\s*)csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[2]) : null;
  }

  function buildHeaders(method) {
    const headers = { 'Content-Type': 'application/json' };
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const csrfToken = getCsrfToken();
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    }
    return headers;
  }

  async function req(path, opts = {}) {
    const url = base + path;
    const method = (opts.method || 'GET').toUpperCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const cfg = {
      method,
      credentials: 'include',
      headers: buildHeaders(method),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    };

    let r;
    try {
      r = await fetch(url, cfg);
    } catch (networkErr) {
      clearTimeout(timer);
      const msg = controller.signal.aborted
        ? 'Délai dépassé. Vérifiez votre connexion.'
        : 'Serveur injoignable. Vérifiez votre connexion.';
      console.error('[API] Échec réseau vers', url, networkErr.message);
      throw Object.assign(new Error(msg), { status: 0, network: true });
    }
    clearTimeout(timer);

    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }

    /* ⭐ v6.2.9 : CSRF invalide → message clair + redirection login */
    if (r.status === 403 && data?.code === 'CSRF_INVALID') {
      console.warn('[API] Token CSRF invalide ou manquant');
      throw Object.assign(
        new Error('Session de sécurité expirée. Rechargez la page (F5).'),
        { status: 403, data, csrf: true }
      );
    }

    if (r.status === 401) {
      throw Object.assign(
        new Error(data.error || 'Non authentifié'),
        { status: 401, data, unauthenticated: true }
      );
    }

    if (!r.ok) {
      throw Object.assign(
        new Error(data.error || `Erreur ${r.status}`),
        { status: r.status, data }
      );
    }

    return data;
  }

  return {
    get:  p       => req(p),
    post: (p, b)  => req(p, { method: 'POST',   body: b }),
    put:  (p, b)  => req(p, { method: 'PUT',    body: b }),
    del:  p       => req(p, { method: 'DELETE' }),
    patch:(p, b)  => req(p, { method: 'PATCH',  body: b }),

    me:    ()     => req('/me'),
    login: (e, p) => req('/login',  { method: 'POST', body: { email: e, password: p } }),
    logout:()     => req('/logout', { method: 'POST' }),

    withdrawal: {
      requestOtp: (amount, devise, password) =>
        req('/withdrawal/request-otp', { method: 'POST', body: { amount, devise, password } }),
      confirm:    (code) =>
        req('/withdrawal/confirm',    { method: 'POST', body: { code } }),
      audit:      () => req('/withdrawal/audit')
    },

    _getCsrfToken: getCsrfToken
  };
})();

/* ═══════════════════════════════════════════════════════════════════ */
/* DÉTECTION AUTOMATIQUE DE NOUVELLE VERSION                          */
/* ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const CHECK_INTERVAL_MS = 10 * 60 * 1000;   /* 10 min */
  const DISMISSED_KEY = 'update-dismissed-version';
  const INITIAL_VERSION = window.APP?.VERSION;

  if (!INITIAL_VERSION) return;
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;

  async function checkVersion() {
    try {
      const r = await fetch('/api/version', { credentials: 'include' });
      if (!r.ok) return;
      const { version } = await r.json();
      if (!version) return;

      if (version === INITIAL_VERSION) {
        removeBanner();
        sessionStorage.removeItem(DISMISSED_KEY);
        return;
      }

      const dismissed = sessionStorage.getItem(DISMISSED_KEY);
      if (dismissed === version) return;

      showUpdateBanner(version);
    } catch (_) {}
  }

  function showUpdateBanner(newVersion) {
    if (document.getElementById('update-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
      background: linear-gradient(135deg, #7c3aed, #22d3ee);
      color: white; text-align: center; padding: 10px 16px;
      font-family: Inter, system-ui, sans-serif; font-weight: 600;
      box-shadow: 0 2px 12px rgba(0,0,0,.3);
      display: flex; align-items: center; justify-content: center;
      gap: 16px; flex-wrap: wrap;
    `;
    banner.innerHTML = `
      <span>✨ Nouvelle version disponible (v${newVersion})</span>
      <div style="display:flex;gap:8px;">
        <button id="update-reload" style="
          padding: 5px 14px; background: rgba(255,255,255,.25);
          border: 1px solid rgba(255,255,255,.4);
          color: white; border-radius: 999px; cursor: pointer;
          font-weight: 700; font-family: inherit; font-size:.85rem;
        ">🔄 Actualiser</button>
        <button id="update-close" style="
          padding: 5px 12px; background: transparent; border: none;
          color: white; cursor: pointer; font-weight: 700;
          font-family: inherit; font-size:1rem; opacity: .7;
        " title="Ignorer">✕</button>
      </div>
    `;
    document.body.prepend(banner);

    document.getElementById('update-reload').addEventListener('click', () => {
      sessionStorage.setItem(DISMISSED_KEY, newVersion);
      location.reload();
    });
    document.getElementById('update-close').addEventListener('click', () => {
      sessionStorage.setItem(DISMISSED_KEY, newVersion);
      removeBanner();
    });
  }

  function removeBanner() {
    const b = document.getElementById('update-banner');
    if (b) b.remove();
  }

  setTimeout(checkVersion, 5000);
  setInterval(checkVersion, CHECK_INTERVAL_MS);
})();