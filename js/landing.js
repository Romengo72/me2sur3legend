// C:\Me\AppMoney\MeParisPortifs\js\landing.js
(function () {
  'use strict';

  const fmt = (v, d = 0) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
  const esc = (s) => (window.APP && window.APP._esc)
    ? window.APP._esc(s) : String(s ?? '');

  // NAVBAR MOBILE
  document.getElementById('nav-toggle')?.addEventListener('click', () => {
    document.querySelector('.landing-nav')?.classList.toggle('open');
  });

  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelector('.landing-nav')?.classList.remove('open');
    });
  });

  // STATS HERO
  async function loadStats() {
    try {
      const r = await fetch('/api/public/stats').then(x => x.json());
      animateNumber('stat-users', r.users || 0);
      animateNumber('stat-saisies', r.saisies || 0);
      document.getElementById('stat-volume').textContent = fmt(r.total_volume || 0);
    } catch (_) {
      ['stat-users','stat-saisies'].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.textContent = '—';
      });
    }
  }

  function animateNumber(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const startTime = performance.now();
    function step(now) {
      const p = Math.min((now - startTime) / 1200, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // PRICING
  async function loadPricing() {
    const el = document.getElementById('pricing-grid');
    if (!el) return;
    try {
      const plans = await fetch('/api/public/plans').then(r => r.json());
      if (!plans || plans.length === 0) {
        el.innerHTML = '<div class="empty" style="grid-column:1/-1;">Aucun plan configuré</div>';
        return;
      }

      el.innerHTML = plans.map(p => {
        const color = p.couleur === 'violet' ? '#7c3aed'
                    : p.couleur === 'or'     ? '#f59e0b'
                    : p.couleur === 'cyan'   ? '#22d3ee'
                    : '#94a3b8';
        const popular = p.popular ? 'popular' : '';
        
        const price = Number(p.price_monthly) === 0
          ? '<span class="price-free">Gratuit</span>'
          : `<span class="price-num">${fmt(p.price_monthly)}</span><span class="price-cur">XAF/mois</span>`;

        let features = [];
        try {
          features = typeof p.features === 'string' ? JSON.parse(p.features) : p.features;
        } catch(e) { features = []; }

        return `
          <div class="pricing-card ${popular}" style="--accent:${color};">
            ${p.popular ? '<div class="popular-badge">⭐ POPULAIRE</div>' : ''}
            <div class="pricing-name" style="color:${color}">${esc(p.name)}</div>
            <div class="pricing-price">${price}</div>
            <div class="pricing-desc">${esc(p.description || '')}</div>
            <ul class="pricing-features">
              ${(features || []).map(f => `<li>✓ ${esc(f)}</li>`).join('')}
            </ul>
            <a href="/login?tab=register&plan=${p.code}" class="btn btn-plan ${p.popular ? '' : 'ghost'}">
              ${Number(p.price_monthly) === 0 ? 'Commencer gratuitement' : 'Choisir ' + esc(p.name)}
            </a>
          </div>
        `;
      }).join('');
    } catch (e) {
      el.innerHTML = '<div class="empty" style="grid-column:1/-1;">Erreur chargement des tarifs</div>';
    }
  }

  // TESTIMONIALS
  async function loadTestimonials() {
    const el = document.getElementById('testimonials-grid');
    if (!el) return;
    try {
      const list = await fetch('/api/public/testimonials').then(r => r.json());
      if (!list || !list.length) { el.parentElement.style.display = 'none'; return; }
      el.innerHTML = list.map(t => {
        // Sécurité si la note est manquante
        const note = Number(t.note) || 5;
        return `
        <div class="testimonial-card">
          <div class="testimonial-stars">${'★'.repeat(note)}${'☆'.repeat(5 - note)}</div>
          <p class="testimonial-text">"${esc(t.contenu)}"</p>
          <div class="testimonial-author">
            <strong>${esc(t.auteur)}</strong>
            <span>${esc(t.pays)}</span>
          </div>
        </div>
      `}).join('');
    } catch (_) {
      el.parentElement.style.display = 'none';
    }
  }

  // LEADERBOARD
  async function loadLeaderboard() {
    const el = document.getElementById('leaderboard-content');
    if (!el) return;
    try {
      const list = await fetch('/api/public/leaderboard').then(r => r.json());
      if (!list || !list.length) {
        el.innerHTML = '<div class="empty" style="padding:40px;text-align:center;color:var(--txt-dim);">Classement en cours de constitution (aucun joueur actif pour le moment).</div>';
        return;
      }
      el.innerHTML = `
        <table class="public-lb-table">
          <thead><tr><th>Rang</th><th>Utilisateur</th><th>Capital XAF</th></tr></thead>
          <tbody>
            ${list.map(r => `
              <tr>
                <td class="rank ${r.rank === 1 ? 'gold' : r.rank === 2 ? 'silver' : r.rank === 3 ? 'bronze' : ''}">
                  #${r.rank}
                </td>
                <td><code>${esc(r.email)}</code></td>
                <td><strong>${fmt(r.balance, 2)}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (_) {
      el.innerHTML = '<div class="empty">Erreur de chargement du classement</div>';
    }
  }

  // NEWS
async function loadNews() {
  const el = document.getElementById('news-grid');
  if (!el) return;
  try {
    const news = await fetch('/api/public/news').then(r => r.json());
    if (!news || !news.length) {
      el.innerHTML = '<div class="empty" style="grid-column:1/-1;text-align:center;color:var(--txt-dim);padding:20px;">Aucune actualité pour le moment.</div>';
      return;
    }
    el.innerHTML = news.map(n => `
      <div class="news-card">
        <div class="date">${new Date(n.published_at).toLocaleDateString('fr-FR')}</div>
        <h4>${esc(n.title)}</h4>
        <p>${esc(n.excerpt || '')}</p>
      </div>
    `).join('');
  } catch (_) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1;text-align:center;color:var(--txt-dim);">Erreur de chargement des actualités.</div>';
  }
}

  // FAQ
  async function loadFaq() {
    const el = document.getElementById('faq-list');
    if (!el) return;
    try {
      const list = await fetch('/api/public/faq').then(r => r.json());
      el.innerHTML = list.map((f, i) => `
        <details class="faq-item" ${i === 0 ? 'open' : ''}>
          <summary>${esc(f.question)}</summary>
          <div class="faq-answer">${f.reponse}</div>
        </details>
      `).join('');
    } catch (_) {
      el.innerHTML = '<div class="empty">Erreur de chargement de la FAQ</div>';
    }
  }

  // ADS
  async function chargerAdDans(containerId, slot) {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const ad = await fetch(`/api/public/ads?slot=${slot}`).then(r => r.json());
      if (!ad || !ad.title) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.innerHTML = `
        <a class="ad-banner" href="${ad.target_url || '#'}" target="_blank" style="background:${ad.bg_color || '#7c3aed'};color:${ad.text_color || '#fff'}">
          <div class="ad-content">
            <div class="ad-badge">Publicité</div>
            <div class="ad-title">${esc(ad.title)}</div>
          </div>
          <div class="ad-cta">${ad.cta_text || 'Découvrir'} →</div>
        </a>`;
    } catch { el.style.display = 'none'; }
  }

  // INITIALISATION
  document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadPricing();
    loadTestimonials();
    loadLeaderboard();
    loadNews();
    loadFaq();
    chargerAdDans('landingAdTop', 'header_banner');
    chargerAdDans('landingAdMid', 'content_mid');
  });
})();