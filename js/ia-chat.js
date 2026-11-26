// C:\Me\AppMoney\MeParisPortifs\js\ia-chat.js
(function () {
  'use strict';

  if (window.__IA_CHAT_LOADED__) return;
  window.__IA_CHAT_LOADED__ = true;

  const MAX_LEN = 2000;
  const state = { open: false, sending: false, history: [] };

  function initChat() {
    let fab = document.getElementById('chat-ia-fab');
    if (!fab) {
      fab = document.createElement('button');
      fab.id = 'chat-ia-fab';
      fab.type = 'button';
      fab.innerHTML = '🤖';
      fab.title = 'Chat IA';
      document.body.appendChild(fab);
    }

    let panel = document.getElementById('chat-ia-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'chat-ia-panel';
      panel.innerHTML = `
        <div class="chat-header">
          <div class="chat-header-title"><strong>🤖 Assistant IA</strong></div>
          <div class="chat-header-actions">
            <button type="button" id="chat-clear" title="Effacer">🗑️</button>
            <button type="button" id="chat-close" title="Fermer">✕</button>
          </div>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-row">
          <input type="text" id="chat-input" maxlength="${MAX_LEN}" placeholder="Pose ta question…">
          <button type="button" id="chat-send">➤</button>
        </div>
      `;
      document.body.appendChild(panel);
    }

    const closeBtn = document.getElementById('chat-close');
    const clearBtn = document.getElementById('chat-clear');
    const input = document.getElementById('chat-input');
    const sendBtn = document.getElementById('chat-send');
    const messages = document.getElementById('chat-messages');

    // ⭐ FONCTION TOGGLE CENTRALE
    function toggleChat(forceOpen) {
      state.open = forceOpen !== undefined ? forceOpen : !state.open;
      if (state.open) {
        panel.classList.add('open');
        fab.classList.add('hidden');
        input.focus();
      } else {
        panel.classList.remove('open');
        fab.classList.remove('hidden');
      }
    }

    function renderMessages() {
      messages.innerHTML = '';
      if (state.history.length === 0) {
        messages.innerHTML = `<div class="ia-chat-msg ai">👋 Salut ! Pose-moi une question sur les cotes ou la stratégie 2/3.</div>`;
        return;
      }
      state.history.forEach(m => {
        const div = document.createElement('div');
        div.className = 'ia-chat-msg ' + m.role;
        div.textContent = m.text;
        messages.appendChild(div);
      });
      if (state.sending) {
        messages.innerHTML += `<div class="ia-chat-msg ai typing"><span></span><span></span><span></span></div>`;
      }
      messages.scrollTop = messages.scrollHeight;
    }

    async function sendMessage() {
      if (state.sending) return;
      const txt = input.value.trim();
      if (!txt) return;

      state.history.push({ role: 'user', text: txt });
      input.value = '';
      state.sending = true;
      renderMessages();

      try {
        const r = await API.post('/ia/chat', { message: txt });
        state.history.push({ role: 'ai', text: r.reponse });
      } catch (e) {
        state.history.push({ role: 'error', text: '❌ ' + (e.data?.error || e.message) });
      } finally {
        state.sending = false;
        renderMessages();
      }
    }

    // Événements
    fab.addEventListener('click', () => toggleChat());
    closeBtn.addEventListener('click', () => toggleChat(false));
    clearBtn.addEventListener('click', () => { state.history = []; renderMessages(); });
    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    renderMessages();

    // ⭐ Exposer l'API pour le menu de gauche
    window.IAChat = {
      open: () => toggleChat(true),
      close: () => toggleChat(false),
      toggle: () => toggleChat()
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChat);
  else initChat();
})();