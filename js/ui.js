// C:\Me\AppMoney\MeParisPortifs\js\ui.js
window.UI = (() => {
  'use strict';

  const esc = (s) => {
    if (window.APP && typeof window.APP._esc === 'function') return window.APP._esc(s);
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (_) {}
    if (!saved) {
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      saved = prefersLight ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeButton();
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (_) {}
    updateThemeButton();
  }

  function updateThemeButton() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const cur = document.documentElement.getAttribute('data-theme');
    btn.textContent = cur === 'dark' ? '🌗 Thème clair' : '🌗 Thème sombre';
  }

  const TOAST_COLORS = {
    info:    'linear-gradient(135deg,#4f46e5,#22d3ee)',
    success: 'linear-gradient(135deg,#10b981,#22d3ee)',
    error:   'linear-gradient(135deg,#ef4444,#f59e0b)',
    warn:    'linear-gradient(135deg,#f59e0b,#ef4444)'
  };
  const TOAST_DURATION = { info: 3500, success: 4000, warn: 5000, error: 6500 };

  function ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      c.setAttribute('role', 'status');
      c.setAttribute('aria-live', 'polite');
      Object.assign(c.style, {
        position: 'fixed', top: '20px', right: '20px',
        zIndex: 99999, display: 'flex', flexDirection: 'column', gap: '10px',
        pointerEvents: 'none'
      });
      document.body.appendChild(c);
    }
    return c;
  }

  function toast(message, type = 'info', duration) {
    const d = duration ?? TOAST_DURATION[type] ?? 3500;
    const el = document.createElement('div');
    el.textContent = message;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    Object.assign(el.style, {
      padding: '14px 20px', borderRadius: '12px',
      background: TOAST_COLORS[type] || TOAST_COLORS.info,
      color: '#fff', fontWeight: 600, fontSize: '.9rem',
      boxShadow: '0 8px 30px rgba(0,0,0,.4)',
      opacity: '0', transform: 'translateX(30px)',
      transition: 'opacity .3s, transform .3s',
      maxWidth: '380px', wordBreak: 'break-word',
      fontFamily: 'inherit', pointerEvents: 'auto', cursor: 'pointer'
    });

    el.addEventListener('click', () => dismiss());
    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      el.style.opacity = '0';
      el.style.transform = 'translateX(30px)';
      setTimeout(() => el.remove(), 300);
    }
    ensureToastContainer().appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
    });
    setTimeout(dismiss, d);
  }

  function confirm(message, title = 'Confirmation', opts = {}) {
    return new Promise(resolve => {
      const allowHtml = opts && opts.html === true;
      const safeTitle = esc(title);
      const safeContent = allowHtml ? message : esc(message);

      const confirmText = opts.confirmText || 'Confirmer';
      const cancelText  = opts.cancelText  || 'Annuler';
      const isDanger    = opts.danger === true;
      // ⭐ Masque le bouton Annuler si cancelText est vide
      const showCancel  = cancelText.trim() !== '';

      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      Object.assign(overlay.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
        zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)', padding: '20px'
      });

      const dangerStyle = isDanger ? 'background:linear-gradient(135deg,#ef4444,#f59e0b);' : '';

      overlay.innerHTML = `
        <div class="glass confirm-modal" style="max-width:460px;padding:28px;width:100%;">
          <h3 style="margin-bottom:14px;font-size:1.15rem;font-weight:700;">${safeTitle}</h3>
          <div class="confirm-message" style="color:var(--txt-dim);margin-bottom:24px;line-height:1.55;">
            ${safeContent}
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            ${showCancel ? `<button class="btn ghost" data-answer="0">${esc(cancelText)}</button>` : ''}
            <button class="btn" data-answer="1" style="${dangerStyle}" autofocus>${esc(confirmText)}</button>
          </div>
        </div>`;

      const closeWith = (val) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeWith(false); }
        else if (e.key === 'Enter') {
          const active = document.activeElement;
          if (active && active.dataset && active.dataset.answer === '1') { e.preventDefault(); closeWith(true); }
          else if (active && active.dataset && active.dataset.answer === '0') { e.preventDefault(); closeWith(false); }
        }
      };

      overlay.addEventListener('click', e => {
        const b = e.target.closest('button[data-answer]');
        if (!b) return;
        closeWith(b.dataset.answer === '1');
      });

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
    });
  }

  function prompt(opts = {}) {
    const title = opts.title || 'Saisie';
    const message = opts.message || '';
    const placeholder = opts.placeholder || '';
    const defaultValue = opts.defaultValue || '';
    const confirmText = opts.confirmText || 'Valider';
    const cancelText = opts.cancelText || 'Annuler';
    const expected = opts.expectedValue || null;
    const isDanger = opts.danger === true;
    const showCancel = cancelText.trim() !== '';

    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      Object.assign(overlay.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)',
        zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)', padding: '20px'
      });

      const dangerStyle = isDanger ? 'background:linear-gradient(135deg,#ef4444,#f59e0b);' : '';

      overlay.innerHTML = `
        <div class="glass confirm-modal" style="max-width:460px;padding:28px;width:100%;">
          <h3 style="margin-bottom:14px;font-size:1.15rem;font-weight:700;">${esc(title)}</h3>
          ${message ? `<div style="color:var(--txt-dim);margin-bottom:14px;line-height:1.55;">${esc(message)}</div>` : ''}
          <input type="text" class="input" id="ui-prompt-input"
                 placeholder="${esc(placeholder)}" value="${esc(defaultValue)}"
                 autocomplete="off" style="margin-bottom:20px;">
          ${expected ? `<div style="color:var(--txt-dim);font-size:.8rem;margin-top:-14px;margin-bottom:16px;">
            Tapez <code style="color:var(--cyan);">${esc(expected)}</code> pour confirmer
          </div>` : ''}
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
            ${showCancel ? `<button class="btn ghost" data-answer="0">${esc(cancelText)}</button>` : ''}
            <button class="btn" data-answer="1" style="${dangerStyle}">${esc(confirmText)}</button>
          </div>
        </div>`;

      const input = overlay.querySelector('#ui-prompt-input');
      const closeWith = (val) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(val);
      };

      const tryConfirm = () => {
        const v = input.value.trim();
        if (expected && v !== expected) {
          input.style.borderColor = 'var(--rouge)';
          input.focus();
          return;
        }
        closeWith(v);
      };

      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); closeWith(null); }
        else if (e.key === 'Enter') { e.preventDefault(); tryConfirm(); }
      };

      overlay.addEventListener('click', e => {
        const b = e.target.closest('button[data-answer]');
        if (!b) return;
        if (b.dataset.answer === '0') closeWith(null);
        else tryConfirm();
      });

      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(overlay);
      setTimeout(() => input && input.focus(), 80);
    });
  }

  let loaderCount = 0;
  function showLoader() {
    loaderCount++;
    let el = document.getElementById('global-loader');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-loader';
      el.setAttribute('role', 'status');
      Object.assign(el.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
        zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)'
      });
      el.innerHTML = `<div class="logo-pulse" style="width:60px;height:60px;"></div>`;
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  }

  function hideLoader() {
    loaderCount = Math.max(0, loaderCount - 1);
    if (loaderCount === 0) {
      const el = document.getElementById('global-loader');
      if (el) el.style.display = 'none';
    }
  }

  async function withLoader(fn) {
    showLoader();
    try { return await fn(); }
    finally { hideLoader(); }
  }

  function bindThemeButton() {
    const btn = document.getElementById('theme-toggle');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', toggleTheme);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    bindThemeButton();
  });
  initTheme();

  return {
    initTheme, toggleTheme, toast, confirm, prompt,
    alert: (message, title = 'Information') =>
      confirm(message, title, { confirmText: 'OK', cancelText: '' }),
    showLoader, hideLoader, withLoader
  };
})();