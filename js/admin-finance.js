// C:\Me\AppMoney\MeParisPortifs\js\admin-finance.js
(function () {
  'use strict';

  if (typeof Navigation === 'undefined') return;

  const fmt = (v, d = 2) => Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: d, maximumFractionDigits: d
  });
  const fmtInt = (v) => Number(v || 0).toLocaleString('fr-FR');
  const pct = (v, d = 2) => (Number(v || 0) * 100).toFixed(d) + '%';
  const esc = (s) => (window.APP && window.APP._esc) ? window.APP._esc(s) : String(s ?? '');

  let charts = { profit: null, marge: null };

  async function safeGet(path, fallback = null) {
    try { return await API.get(path); }
    catch (e) { console.warn('[finance] GET', path, e.message); return fallback; }
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* RENDU PRINCIPAL                                                  */
  /* ═══════════════════════════════════════════════════════════════ */
  async function render(c) {
    if (!c) c = document.getElementById('admin-content');
    if (!c) return;

    c.innerHTML = '<div class="empty"><span class="spinner"></span> Chargement…</div>';

    const [overview, daily, marges, alerts, seuils] = await Promise.all([
      safeGet('/admin/finance/overview', {}),
      safeGet('/admin/finance/daily?days=30', []),
      safeGet('/admin/finance/marges-matchs?limit=100', []),
      safeGet('/admin/finance/alerts', []),
      safeGet('/admin/finance/seuils', { margeMin: 0.02, margeAlerte: 0.015 })
    ]);

    const profitMois = daily.reduce((s, d) => s + d.profit, 0);

    c.innerHTML = `
      <h2 style="margin-bottom:20px;">💰 Dashboard financier</h2>

      <!-- ═════════ KPI CARDS ═════════ -->
      <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:22px;">
        <div class="stat-card">
          <div class="stat-label">Volume misé (total)</div>
          <div class="stat-value">${fmtInt(overview.volume)} XAF</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Gains payés</div>
          <div class="stat-value" style="color:var(--orange);">${fmtInt(overview.gains)} XAF</div>
        </div>
        <div class="stat-card" style="background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.3);">
          <div class="stat-label">💰 Profit structure</div>
          <div class="stat-value" style="color:var(--vert);">${fmtInt(overview.profit)} XAF</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Marge effective</div>
          <div class="stat-value ${overview.margeEffective >= seuils.margeAlerte ? '' : 'text-orange'}">
            ${pct(overview.margeEffective)}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Marge marché moyenne</div>
          <div class="stat-value">${pct(overview.margeMarche)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Marge IA moyenne</div>
          <div class="stat-value">${pct(overview.margeIA)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Profit 30 jours</div>
          <div class="stat-value" style="color:${profitMois >= 0 ? 'var(--vert)' : 'var(--rouge)'};">
            ${profitMois >= 0 ? '+' : ''}${fmtInt(profitMois)} XAF
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Utilisateurs actifs (30j)</div>
          <div class="stat-value">${overview.usersActifs || 0} / ${overview.users || 0}</div>
        </div>
      </div>

      <!-- ═════════ GRAPHIQUES ═════════ -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-bottom:24px;">
        <div class="glass" style="padding:20px;">
          <h3 style="margin-bottom:14px;font-size:.95rem;">📈 Profit / jour (30 derniers)</h3>
          <canvas id="chart-profit" height="200"></canvas>
        </div>
        <div class="glass" style="padding:20px;">
          <h3 style="margin-bottom:14px;font-size:.95rem;">📊 Marge / jour (30 derniers)</h3>
          <canvas id="chart-marge" height="200"></canvas>
        </div>
      </div>

      <!-- ═════════ SEUILS ═════════ -->
      <div class="glass" style="padding:18px 22px;margin-bottom:24px;">
        <h3 style="margin-bottom:14px;font-size:.95rem;">⚙️ Seuils de sécurité</h3>
        <div class="admin-form" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:end;">
          <div class="admin-field">
            <label>Marge minimale IA (refus)</label>
            <input type="number" step="0.001" class="input" id="fin-marge-min"
                   value="${seuils.margeMin}">
          </div>
          <div class="admin-field">
            <label>Seuil d'alerte</label>
            <input type="number" step="0.001" class="input" id="fin-marge-alerte"
                   value="${seuils.margeAlerte}">
          </div>
          <div>
            <button class="btn" id="fin-seuils-save" style="width:100%;">💾 Enregistrer</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;">
          <button class="btn ghost sm" id="fin-scan">🔍 Scanner les matchs</button>
          <button class="btn ghost sm" id="fin-refresh">🔄 Recharger</button>
        </div>
      </div>

      <!-- ═════════ SIMULATEUR ═════════ -->
      <div class="glass" style="padding:20px 22px;margin-bottom:24px;">
        <h3 style="margin-bottom:14px;font-size:.95rem;">🎯 Simulateur de projection</h3>
        <div class="admin-form" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;align-items:end;">
          <div class="admin-field">
            <label>Utilisateurs</label>
            <input type="number" class="input" id="sim-users" value="100" min="1">
          </div>
          <div class="admin-field">
            <label>Paris / user / jour</label>
            <input type="number" class="input" id="sim-paris" value="5" min="1">
          </div>
          <div class="admin-field">
            <label>Mise moyenne (XAF)</label>
            <input type="number" class="input" id="sim-mise" value="1500" min="100" step="100">
          </div>
          <div class="admin-field">
            <label>Marge</label>
            <input type="number" class="input" id="sim-marge" value="0.02" step="0.005" min="0">
          </div>
          <button class="btn" id="sim-run">🚀 Simuler</button>
        </div>
        <div id="sim-result" style="margin-top:18px;"></div>
      </div>

      <!-- ═════════ ALERTES ═════════ -->
      ${alerts.length ? `
        <h3 style="margin-bottom:14px;">🚨 Alertes (${alerts.length})</h3>
        <div class="admin-list" style="margin-bottom:24px;">
          ${alerts.map(a => `
            <div class="admin-item" style="border-left:4px solid ${a.severity === 'critical' ? 'var(--rouge)' : 'var(--orange)'};">
              <div style="flex:1;">
                <strong>${esc(a.message)}</strong>
                <div style="font-size:.78rem;color:var(--txt-dim);margin-top:4px;">
                  ${new Date(a.created_at).toLocaleString('fr-FR')}
                  · Marge : ${pct(a.marge)}
                </div>
              </div>
              <button class="btn ghost sm" data-alert-resolve="${a.id}">✅ Résoudre</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ═════════ MATCHS AVEC MARGE ═════════ -->
      <h3 style="margin-bottom:14px;">📋 Matchs récents et leur marge</h3>
      <div class="admin-table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Match</th>
              <th>Source</th>
              <th>Marge marché</th>
              <th>Marge IA</th>
              <th>Alerte</th>
            </tr>
          </thead>
          <tbody>
            ${marges.slice(0, 40).map(m => `
              <tr>
                <td>
                  <strong>${esc(m.equipe1)}</strong> vs <strong>${esc(m.equipe2)}</strong>
                  <div style="font-size:.72rem;color:var(--txt-dim);">${esc(m.league || '')}</div>
                </td>
                <td>
                  ${m.ia_generated
                    ? '<span class="badge-tab" style="background:linear-gradient(135deg,#f59e0b,#ef4444);">👑 IA</span>'
                    : '<span class="badge-tab">🌐 Marché</span>'}
                </td>
                <td style="font-family:monospace;color:${m.marge_marche < 0 ? 'var(--rouge)' : m.marge_marche < 0.015 ? 'var(--orange)' : 'var(--vert)'};">
                  ${m.marge_marche !== null ? pct(m.marge_marche) : '—'}
                </td>
                <td style="font-family:monospace;color:${m.marge_ia === null ? 'var(--txt-dim)' : m.marge_ia < 0 ? 'var(--rouge)' : m.marge_ia < 0.02 ? 'var(--orange)' : 'var(--vert)'};">
                  ${m.marge_ia !== null ? pct(m.marge_ia) : '—'}
                </td>
                <td>
                  ${m.alerte_ia ? '<span style="color:var(--rouge);">⚠️ Marge IA faible</span>' : ''}
                  ${m.alerte_marche && !m.alerte_ia ? '<span style="color:var(--orange);">⚠️ Marché</span>' : ''}
                  ${!m.alerte_ia && !m.alerte_marche ? '<span style="color:var(--vert);">✅ OK</span>' : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    /* Graphiques */
    drawProfitChart(daily);
    drawMargeChart(daily);

    /* Events */
    bindEvents(c, alerts, marges);
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* GRAPHIQUES                                                       */
  /* ═══════════════════════════════════════════════════════════════ */
  function drawProfitChart(daily) {
    const ctx = document.getElementById('chart-profit');
    if (!ctx || !window.Chart) return;
    if (charts.profit) charts.profit.destroy();

    charts.profit = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: daily.map(d => new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
        datasets: [{
          label: 'Profit (XAF)',
          data: daily.map(d => d.profit),
          backgroundColor: daily.map(d => d.profit >= 0 ? 'rgba(16,185,129,.7)' : 'rgba(239,68,68,.7)'),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#a0a0c0' }, grid: { color: 'rgba(124,58,237,.1)' } },
          x: { ticks: { color: '#a0a0c0' }, grid: { display: false } }
        }
      }
    });
  }

  function drawMargeChart(daily) {
    const ctx = document.getElementById('chart-marge');
    if (!ctx || !window.Chart) return;
    if (charts.marge) charts.marge.destroy();

    charts.marge = new Chart(ctx, {
      type: 'line',
      data: {
        labels: daily.map(d => new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
        datasets: [{
          label: 'Marge (%)',
          data: daily.map(d => (d.marge * 100).toFixed(2)),
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34,211,238,.15)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#7c3aed',
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: { color: '#a0a0c0', callback: v => v + '%' },
            grid: { color: 'rgba(124,58,237,.1)' }
          },
          x: { ticks: { color: '#a0a0c0' }, grid: { display: false } }
        }
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* ÉVÉNEMENTS                                                       */
  /* ═══════════════════════════════════════════════════════════════ */
  function bindEvents(c, alerts, marges) {
    /* Save seuils */
    document.getElementById('fin-seuils-save')?.addEventListener('click', async () => {
      const margeMin = Number(document.getElementById('fin-marge-min').value);
      const margeAlerte = Number(document.getElementById('fin-marge-alerte').value);
      try {
        await API.put('/admin/finance/seuils', { margeMin, margeAlerte });
        UI.toast('✅ Seuils enregistrés', 'success');
      } catch (e) { UI.toast('❌ ' + (e.data?.error || e.message), 'error'); }
    });

    /* Scan */
    document.getElementById('fin-scan')?.addEventListener('click', async () => {
      try {
        UI.showLoader();
        const r = await API.post('/admin/finance/scan', {});
        UI.hideLoader();
        UI.toast(`✅ ${r.alertes_crees} nouvelle(s) alerte(s) créée(s)`, 'success');
        window.AdminFinance.render(c);
      } catch (e) { UI.hideLoader(); UI.toast('❌ ' + (e.data?.error || e.message), 'error'); }
    });

    /* Refresh */
    document.getElementById('fin-refresh')?.addEventListener('click', () => window.AdminFinance.render(c));

    /* Simulateur */
    document.getElementById('sim-run')?.addEventListener('click', async () => {
      const users = document.getElementById('sim-users').value;
      const paris = document.getElementById('sim-paris').value;
      const mise = document.getElementById('sim-mise').value;
      const marge = document.getElementById('sim-marge').value;

      try {
        const r = await API.get(
          `/admin/finance/projection?users=${users}&paris=${paris}&mise=${mise}&marge=${marge}`);
        const el = document.getElementById('sim-result');
        el.innerHTML = `
          <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
            <div class="stat-card">
              <div class="stat-label">Volume / jour</div>
              <div class="stat-value">${fmtInt(r.volumeJour)} XAF</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Profit / jour</div>
              <div class="stat-value" style="color:var(--vert);">${fmtInt(r.profitJour)} XAF</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Profit / semaine</div>
              <div class="stat-value" style="color:var(--vert);">${fmtInt(r.profitSemaine)} XAF</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Profit / mois</div>
              <div class="stat-value" style="color:var(--vert);">${fmtInt(r.profitMois)} XAF</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Profit / an</div>
              <div class="stat-value" style="color:var(--cyan);font-size:1.5rem;">${fmtInt(r.profitAn)} XAF</div>
            </div>
          </div>
          <p style="color:var(--txt-dim);font-size:.8rem;margin-top:10px;">
            Basé sur : ${r.input.users} users × ${r.input.parisJourUser} paris/jour × ${fmtInt(r.input.miseMoyenne)} XAF · marge ${(r.input.marge*100).toFixed(2)}%
          </p>
        `;
      } catch (e) { UI.toast('❌ ' + (e.data?.error || e.message), 'error'); }
    });

    /* Resolve alerts */
    c.querySelectorAll('[data-alert-resolve]').forEach(b => {
      b.addEventListener('click', async () => {
        try {
          await API.post(`/admin/finance/alerts/${b.dataset.alertResolve}/resolve`, {});
          UI.toast('Alerte résolue', 'info');
          window.AdminFinance.render(c);
        } catch (e) { UI.toast('❌ ' + e.message, 'error'); }
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════ */
  /* EXPORT                                                           */
  /* ═══════════════════════════════════════════════════════════════ */
  window.AdminFinance = { render };

})();