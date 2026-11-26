// C:\Me\AppMoney\MeParisPortifs\routes-admin.js
// v6.2.2 — Gain unifié, retrait sans marge silencieuse, clés masquées, logs
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, requireAdmin, requirePermission, logSecurity } = require('./utils');
const { calculerGainAvecMarge } = require('./calculs-server');
const logger = require('./logger');

const router = express.Router();
router.use(authenticateToken, requireAdmin);

/* Masque une clé API : "sk-1234567890abcd" → "sk-1...abcd" */
function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

/* Lit le Budget Fonctionnement courant */
async function getBF(client = pool) {
  const r = await client.query(`SELECT value FROM constantes WHERE key = 'BUDGET_FONCTIONNEMENT'`);
  return Number(r.rows[0]?.value || 0);
}

/* =================================================================== */
/* SETTLEMENT IA                                                       */
/* =================================================================== */
router.post('/settlement/retry/:externalId', async (req, res) => {
  const { externalId } = req.params;
  try {
    const match = await pool.query(
      `SELECT id, equipe1, equipe2, termine, resultat, score1, score2, commence_at
         FROM matches_cache WHERE external_id = $1`, [externalId]);

    if (!match.rows.length) return res.status(404).json({ error: 'Match introuvable.' });

    const m = match.rows[0];
    if (m.termine && m.resultat) {
      return res.status(400).json({
        error: `Match deja regle (resultat : ${m.resultat}).`,
        resultat: m.resultat,
        score: m.score1 !== null && m.score2 !== null ? `${m.score1}-${m.score2}` : '(score non enregistre)'
      });
    }

    if (m.commence_at && new Date(m.commence_at) > new Date(Date.now() - 2 * 60 * 60 * 1000)) {
      return res.status(400).json({ error: 'Match trop recent. Attendez au moins 2h apres le coup d\'envoi.' });
    }

    const autoSettlement = require('./auto-settlement');
    const { fetchScoreAvecFallback, determinerIssue } = autoSettlement;
    const appliquerResultat = autoSettlement.appliquerResultat;

    if (typeof appliquerResultat !== 'function') {
      return res.status(500).json({ error: 'Fonction appliquerResultat non disponible.' });
    }

    const scoreData = await fetchScoreAvecFallback(externalId, 'soccer');
    if (!scoreData) return res.status(404).json({ error: 'Aucune source n\'a fourni de score.' });

    const resultat = determinerIssue(scoreData.score1, scoreData.score2);
    if (!resultat) return res.status(400).json({ error: 'Score invalide recu.', score: scoreData });

    const result = await appliquerResultat(externalId, resultat, scoreData.source, scoreData);

    await logSecurity({
      email: req.user.email, event: 'admin_settlement_retry',
      severity: 'info', ip: req.ip,
      details: { externalId, resultat, source: scoreData.source, result }
    });

    res.json({
      ok: true,
      message: `Match regle : ${resultat} (score ${scoreData.score1}-${scoreData.score2}, source ${scoreData.source})`,
      ...result
    });
  } catch (e) {
    logger.error('[admin/settlement/retry]', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/settlement/status', async (_req, res) => {
  try {
    const [enAttente, reglesRecents, echecs] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM matches_cache WHERE termine = FALSE AND commence_at < NOW() - INTERVAL '2 hours' AND commence_at > NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM matches_cache WHERE termine = TRUE AND updated_at > NOW() - INTERVAL '24 hours'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM matches_cache WHERE termine = FALSE AND commence_at < NOW() - INTERVAL '7 days'`)
    ]);
    res.json({
      en_attente: enAttente.rows[0].n,
      regles_24h: reglesRecents.rows[0].n,
      echoues: echecs.rows[0].n,
      auto_settlement_actif: !!process.env.SPORTRADAR_API_KEY || !!process.env.ODDSPAPI_KEY
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* SYNC SPORTRADAR                                                     */
/* =================================================================== */
router.post('/matches/sync-sportradar', async (_req, res) => {
  try {
    const { syncFromSportradar } = require('./matches-sync-sportradar');
    const result = await syncFromSportradar();
    res.json({
      ok: true, ...result,
      message: result.skipped
        ? `Sync ignoree (${result.reason})`
        : `${result.inserted} match(s) ajoute(s) sur ${result.fetched} recupere(s)`
    });
  } catch (e) {
    logger.error('[admin/matches/sync-sportradar]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* =================================================================== */
/* STATS OVERVIEW                                                      */
/* =================================================================== */
router.get('/stats/overview', async (_req, res) => {
  try {
    const [u, s, bf, balances, margins] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'user'`),
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(mise_totale), 0) AS total FROM saisies WHERE valide`),
      pool.query(`SELECT value FROM constantes WHERE key = 'BUDGET_FONCTIONNEMENT'`),
      pool.query(`SELECT COALESCE(SUM(balance), 0) AS t FROM users WHERE role = 'user'`),
      pool.query(`SELECT COALESCE(SUM(montant), 0) AS t FROM margin_collections`)
    ]);
    res.json({
      users: u.rows[0].n,
      saisies: s.rows[0].n,
      mises: Number(s.rows[0].total),
      bf: Number(bf.rows[0]?.value || 0),
      totalBalances: Number(balances.rows[0].t),
      totalMargins: Number(margins.rows[0].t)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* SAISIES                                                             */
/* =================================================================== */
router.get('/saisies-stats', async (_req, res) => {
  try {
    const total = await pool.query(`SELECT COUNT(*)::int AS n FROM saisies`);
    const valides = await pool.query(`SELECT COUNT(*)::int AS n FROM saisies WHERE valide = TRUE`);
    const pendingRes = await pool.query(`SELECT data FROM saisies WHERE valide = TRUE`);
    let matchesEnAttente = 0;
    pendingRes.rows.forEach(r => {
      const val = r.data.VALIDATION || [];
      val.forEach(m => {
        if (m.valide && (!m.statuts || (!m.statuts['1'] && !m.statuts['N'] && !m.statuts['2']))) {
          matchesEnAttente++;
        }
      });
    });
    res.json({ total_saisies: total.rows[0].n, valides: valides.rows[0].n, matches_en_attente: matchesEnAttente });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/saisies', async (req, res) => {
  try {
    const { statut = 'pending' } = req.query;
    const { rows } = await pool.query(
      `SELECT s.*, u.category FROM saisies s LEFT JOIN users u ON u.email = s.user_email ORDER BY s.moment DESC LIMIT 100`);

    const out = [];
    for (const s of rows) {
      const validation = s.data.VALIDATION || [];
      for (let idx = 0; idx < validation.length; idx++) {
        const m = validation[idx];
        const hasStatut = m.statuts && (m.statuts['1'] || m.statuts['N'] || m.statuts['2']);
        if (statut === 'pending' && (!m.valide || hasStatut)) continue;
        if (statut === 'validated' && (!m.valide || !hasStatut)) continue;

        out.push({
          saisie_id: s.id, idx, user_email: s.user_email, user_id: s.user_email.split('@')[0],
          category: s.category || 'free', equipe1: m.equipe1, equipe2: m.equipe2, cotes: m.cotes,
          statuts: m.statuts, tableauChoisi: m.tableauChoisi || 1, tableaux: m.tableaux,
          miseDebitee: m.miseDebitee, date: s.date, _dejaValide: hasStatut
        });
      }
    }
    res.json({ saisies: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ⭐ v6.2.2 : /saisies/:id/statut utilise calculerGainAvecMarge (aligné avec calculs.js) */
router.post('/saisies/:id/statut', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { idx, statut } = req.body;
    const clientStatut = statut === 'null' ? null : statut;

    if (clientStatut !== null && !['1', 'N', '2'].includes(String(clientStatut))) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    await client.query('BEGIN');
    const s = await client.query(`SELECT * FROM saisies WHERE id = $1 FOR UPDATE`, [id]);
    if (!s.rows.length) throw new Error('Saisie introuvable');

    const row = s.rows[0];
    const data = row.data;
    const m = data.VALIDATION[idx];
    if (!m) throw new Error('Index invalide');
    if (!m.valide) throw new Error('La mise doit d\'abord etre validee.');

    const oldGain = Number(m.gainCredite || 0);
    const oldMargeGain = Number(m.margeGain || 0);
    let newGain = 0, newMargeGain = 0;

    if (clientStatut) {
      const T = m.tableaux[`T${m.tableauChoisi || 1}`];
      const col = T.find(x => x.col === clientStatut);
      if (!col) throw new Error('Colonne introuvable');
      const calc = calculerGainAvecMarge(Number(col.mise), Number(col.cote));
      newGain = calc.gainNet;
      newMargeGain = calc.margeGain;
    }

    const delta = newGain - oldGain;

    /* ⭐ Vérification BF avant crédit */
    if (delta > 0) {
      const bf = await getBF(client);
      if (bf < delta) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Budget Fonctionnement insuffisant : ${bf.toFixed(2)} XAF disponibles, ${delta.toFixed(2)} XAF requis.`
        });
      }
    }

    if (delta !== 0) {
      await client.query(`UPDATE users SET balance = balance + $1 WHERE email = $2`, [delta, row.user_email]);
    }

    m.statuts = { '1': null, 'N': null, '2': null };
    delete m.gainCredite; delete m.Ri; delete m.validePar; delete m.valideLe; delete m.margeGain;

    if (clientStatut) {
      m.statuts[clientStatut] = clientStatut === '1' ? 'vert' : clientStatut === 'N' ? 'orange' : 'rouge';
      m.gainCredite = newGain;
      m.margeGain = newMargeGain;
      m.Ri = newGain - Number(m.miseDebitee);
      m.validePar = req.user.email;
      m.valideLe = new Date().toISOString();

      if (delta !== 0) {
        await client.query(
          `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note) VALUES ($1, 'win', $2, $3, $4)`,
          [row.user_email, delta, String(row.id), `Gain statut ${clientStatut} (Admin)`]);
      }

      if (oldMargeGain > 0) {
        await client.query(`DELETE FROM margin_collections WHERE ref_id = $1 AND user_email = $2 AND type = 'win'`,
          [String(row.id), row.user_email]);
      }
      if (newMargeGain > 0) {
        await client.query(
          `INSERT INTO margin_collections(user_email, type, montant, ref_id, note) VALUES ($1, 'win', $2, $3, $4)`,
          [row.user_email, newMargeGain, String(row.id), `Marge 6% sur gain`]);
      }
    }

    await client.query(`UPDATE saisies SET data = $1 WHERE id = $2`, [data, row.id]);
    await client.query('COMMIT');

    await logSecurity({
      email: req.user.email, event: 'admin_validate_gain', severity: 'info', ip: req.ip,
      details: { saisie_id: row.id, idx, statut: clientStatut, delta }
    });

    res.json({ ok: true, gain: newGain, delta });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

/* =================================================================== */
/* COLLECTE DES DECIMALES                                              */
/* =================================================================== */
router.post('/collect-funds', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const users = await client.query(`SELECT email, balance FROM users WHERE role = 'user' AND balance > 0 FOR UPDATE`);

    if (users.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, collected: 0, nbUsers: 0, message: 'Aucun solde.' });
    }

    const collectes = [];
    let totalCollecte = 0;

    for (const u of users.rows) {
      const balance = Number(u.balance);
      const partieEntiere = Math.floor(balance);
      const partieDecimale = Number((balance - partieEntiere).toFixed(4));
      if (partieDecimale > 0) {
        collectes.push({ email: u.email, ancienSolde: balance, partieDecimale, nouveauSolde: partieEntiere });
        totalCollecte += partieDecimale;
      }
    }

    if (collectes.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, collected: 0, nbUsers: 0, message: 'Aucune decimale.' });
    }

    totalCollecte = Number(totalCollecte.toFixed(2));

    for (const c of collectes) {
      await client.query(`UPDATE users SET balance = $1, updated_at = NOW() WHERE email = $2`, [c.nouveauSolde, c.email]);
      await client.query(
        `INSERT INTO transactions(user_email, type, montant_eur, note) VALUES ($1, 'adjust', $2, $3)`,
        [c.email, -c.partieDecimale, `Collecte decimale (${c.ancienSolde.toFixed(2)} -> ${c.nouveauSolde.toFixed(2)})`]);
    }

    await client.query(`UPDATE constantes SET value = value + $1, updated_at = NOW() WHERE key = 'BUDGET_FONCTIONNEMENT'`, [totalCollecte]);
    await client.query(
      `INSERT INTO admin_collections(admin_email, total_bf, nb_users, date) VALUES ($1, $2, $3, NOW())`,
      [req.user.email, totalCollecte, collectes.length]);

    await client.query('COMMIT');
    logger.info(`[Collecte] ${collectes.length} user(s) — ${totalCollecte.toFixed(2)} XAF`);

    await logSecurity({
      email: req.user.email, event: 'admin_collect_decimals', severity: 'info', ip: req.ip,
      details: { nb_users: collectes.length, total: totalCollecte }
    });

    res.json({
      ok: true, collected: totalCollecte, nbUsers: collectes.length,
      message: `${totalCollecte.toFixed(2)} XAF collectes sur ${collectes.length} utilisateur(s).`
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logger.error('[collect-funds]', e.message);
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

/* =================================================================== */
/* MARGES SILENCIEUSES                                                 */
/* =================================================================== */
router.get('/finance/margins', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      `SELECT mc.*, u.category FROM margin_collections mc LEFT JOIN users u ON u.email = mc.user_email ORDER BY mc.created_at DESC LIMIT $1`, [limit]);
    const total = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type='bet' THEN montant END), 0) AS total_mises,
         COALESCE(SUM(CASE WHEN type='win' THEN montant END), 0) AS total_gains,
         COALESCE(SUM(CASE WHEN type='withdrawal' THEN montant END), 0) AS total_retraits,
         COALESCE(SUM(montant), 0) AS total
       FROM margin_collections`);
    res.json({
      margins: rows,
      totals: {
        mises: Number(total.rows[0].total_mises),
        gains: Number(total.rows[0].total_gains),
        retraits: Number(total.rows[0].total_retraits),
        total: Number(total.rows[0].total)
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* SUSPENSIONS IA                                                      */
/* =================================================================== */
router.get('/ia/suspensions', async (req, res) => {
  try {
    const { active } = req.query;
    let q = `SELECT s.*, u.category FROM ia_suspensions s LEFT JOIN users u ON u.email = s.user_email`;
    if (active === '1') q += ` WHERE s.lifted_at IS NULL AND (s.suspended_until IS NULL OR s.suspended_until > NOW())`;
    q += ` ORDER BY s.suspended_at DESC LIMIT 100`;
    const { rows } = await pool.query(q);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ia/suspensions/:id/lift', async (req, res) => {
  try {
    await pool.query(
      `UPDATE ia_suspensions SET lifted_at = NOW(), lifted_by = $1 WHERE id = $2 AND lifted_at IS NULL`,
      [req.user.email, req.params.id]);
    await logSecurity({ email: req.user.email, event: 'admin_lift_suspension', severity: 'info', ip: req.ip, details: { suspension_id: req.params.id } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* RETRAITS EN ATTENTE                                                 */
/* =================================================================== */
router.get('/withdrawals/pending', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM withdrawal_audit WHERE statut = 'pending_admin' ORDER BY created_at DESC LIMIT 100`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ⭐ v6.2.2 : plus de marge silencieuse sur retrait (aligné avec withdrawal.js) */
router.post('/withdrawals/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const w = await client.query(`SELECT * FROM withdrawal_audit WHERE id = $1 AND statut = 'pending_admin' FOR UPDATE`, [req.params.id]);
    if (!w.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Demande introuvable ou deja traitee.' }); }

    const row = w.rows[0];
    const userEmail = row.user_email;
    const montant = Number(row.amount);   /* montant net demandé */

    const u = await client.query(`SELECT balance, category FROM users WHERE email = $1 FOR UPDATE`, [userEmail]);
    if (!u.rows.length) throw new Error('Utilisateur introuvable');

    const balance = Number(u.rows[0].balance);
    const category = u.rows[0].category || 'free';
    const fee = { free: 0.05, premium: 0.03, vip: 0.025, legendaire: 0.025 }[category] || 0.05;

    const fraisVisibles = Number((montant * fee).toFixed(2));
    const montantDebite = Number((montant + fraisVisibles).toFixed(2));

    if (balance < montantDebite) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Solde insuffisant : ${balance.toFixed(2)} XAF dispo, ${montantDebite.toFixed(2)} requis (net ${montant.toFixed(2)} + frais ${fraisVisibles.toFixed(2)}).`
      });
    }

    await client.query(`UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE email = $2`, [montantDebite, userEmail]);
    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, devise_origine, note) VALUES ($1, 'withdraw', $2, $3, $4)`,
      [userEmail, -montantDebite, row.devise,
       `Retrait approuve (net ${montant.toFixed(2)} + frais ${fraisVisibles.toFixed(2)} = ${montantDebite.toFixed(2)})`]);

    await client.query(`UPDATE withdrawal_audit SET statut = 'success', raison = 'admin_approved' WHERE id = $1`, [row.id]);
    await client.query('COMMIT');

    await logSecurity({ email: req.user.email, event: 'admin_approve_withdrawal', severity: 'warn', ip: req.ip,
      details: { withdrawal_id: row.id, user: userEmail, montant_net: montant, frais: fraisVisibles, total_debite: montantDebite } });

    res.json({ ok: true, message: `Retrait de ${montant.toFixed(2)} XAF approuve (total debite : ${montantDebite.toFixed(2)} XAF).` });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  try {
    const reason = String(req.body?.reason || 'admin_rejected').slice(0, 200);
    await pool.query(`UPDATE withdrawal_audit SET statut = 'failed', raison = $1 WHERE id = $2 AND statut = 'pending_admin'`, [reason, req.params.id]);
    await logSecurity({ email: req.user.email, event: 'admin_reject_withdrawal', severity: 'info', ip: req.ip, details: { withdrawal_id: req.params.id, reason } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* DEMANDES DE SUPPRESSION                                             */
/* =================================================================== */
router.get('/deletion-requests', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM deletion_requests ORDER BY date DESC`);
    res.json(rows);
  } catch (e) { logger.error('[admin/deletion-requests GET]', e.message); res.status(500).json({ error: e.message }); }
});

/* ⭐ v6.2.2 : vérifie le solde avant suppression (rembourse ou bloque) */
router.post('/deletion-requests/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRow = await client.query(`SELECT user_email FROM deletion_requests WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!reqRow.rows.length) throw new Error('Demande introuvable');
    const email = reqRow.rows[0].user_email;

    const u = await client.query(`SELECT balance FROM users WHERE email = $1 FOR UPDATE`, [email]);
    if (u.rows.length && Number(u.rows[0].balance) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Solde positif (${Number(u.rows[0].balance).toFixed(2)} XAF). Remboursez ou annulez avant suppression.`
      });
    }

    await client.query(`DELETE FROM users WHERE email = $1`, [email]);
    await client.query(`DELETE FROM deletion_requests WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');

    await logSecurity({ email: req.user.email, event: 'admin_deleted_user', severity: 'critical', ip: req.ip, details: { deleted_email: email } });
    res.json({ ok: true, message: `Compte de ${email} supprime definitivement.` });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/deletion-requests/:id/reject', async (req, res) => {
  try {
    await pool.query(`UPDATE deletion_requests SET statut = 'rejected' WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, message: 'Demande rejetee.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* PERMISSIONS PAR GROUPE                                              */
/* =================================================================== */
router.get('/permission-groups', requirePermission('can_create_permissions'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT category, permissions, description FROM permission_groups ORDER BY
        CASE category WHEN 'free' THEN 1 WHEN 'premium' THEN 2 WHEN 'vip' THEN 3 WHEN 'legendaire' THEN 4 WHEN 'admin' THEN 5 END`);
    res.json(rows);
  } catch (e) { logger.error('[admin/permission-groups]', e.message); res.status(500).json({ error: e.message }); }
});

router.put('/permission-groups/:category', requirePermission('can_create_permissions'), async (req, res) => {
  try {
    const { category } = req.params;
    const { permissions } = req.body || {};
    if (!permissions || typeof permissions !== 'object') return res.status(400).json({ error: 'Objet permissions requis' });

    const { rowCount } = await pool.query(`UPDATE permission_groups SET permissions = $1, updated_at = NOW() WHERE category = $2`, [JSON.stringify(permissions), category]);
    if (rowCount === 0) return res.status(404).json({ error: 'Groupe introuvable' });

    await logSecurity({ email: req.user.email, event: 'admin_update_group_permissions', severity: 'warn', ip: req.ip, details: { category, permissions } });
    res.json({ ok: true });
  } catch (e) { logger.error(`[admin/permission-groups/${req.params.category}]`, e.message); res.status(500).json({ error: e.message }); }
});

/* =================================================================== */
/* USERS, PERMISSIONS, BALANCE                                         */
/* =================================================================== */
router.get('/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, role, category, balance, full_name, language, created_at FROM users ORDER BY balance DESC LIMIT 500`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/permissions', requirePermission('can_create_permissions'), async (req, res) => {
  try {
    const { user_email } = req.query;
    if (user_email) {
      const u = await pool.query(`SELECT category, role FROM users WHERE email = $1`, [user_email]);
      const overrides = await pool.query(`SELECT permission_key, value FROM user_permission_overrides WHERE user_email = $1`, [user_email]);
      const map = {};
      overrides.rows.forEach(r => { map[r.permission_key] = r.value; });
      return res.json({ category: u.rows[0]?.category || 'free', role: u.rows[0]?.role || 'user', overrides: map });
    }
    const { rows } = await pool.query(`SELECT user_email, permission_key, value FROM user_permission_overrides`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/permissions', requirePermission('can_create_permissions'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_email, permissions } = req.body || {};
    if (!user_email || !permissions) return res.status(400).json({ error: 'Email et permissions requis' });

    await client.query('BEGIN');
    for (const [key, value] of Object.entries(permissions)) {
      await client.query(
        `INSERT INTO user_permission_overrides(user_email, permission_key, value) VALUES ($1, $2, $3)
         ON CONFLICT (user_email, permission_key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [user_email, key, !!value]);
    }
    await client.query('COMMIT');
    await logSecurity({ email: user_email, event: 'admin_permission_update', severity: 'warn', ip: req.ip, details: { by: req.user.email, keys: Object.keys(permissions) } });
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

/* ⭐ v6.2.2 : plafond + log obligatoire sur ajustement de solde */
router.post('/adjust-balance', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_email, delta, note } = req.body || {};
    const d = Number(delta);
    if (!user_email || isNaN(d) || d === 0) return res.status(400).json({ error: 'Email et delta non nul requis' });
    if (Math.abs(d) > 1_000_000) return res.status(400).json({ error: 'Plafond d\'ajustement : ±1 000 000 XAF' });
    if (!note || String(note).trim().length < 3) return res.status(400).json({ error: 'Note obligatoire (3 car. min.)' });

    await client.query('BEGIN');
    const u = await client.query(`SELECT balance FROM users WHERE email = $1 FOR UPDATE`, [user_email]);
    if (!u.rows.length) throw new Error('Utilisateur introuvable');

    const newBalance = Number(u.rows[0].balance) + d;
    if (newBalance < 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Solde résultant négatif (${newBalance.toFixed(2)} XAF).` });
    }

    await client.query(`UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE email = $2`, [d, user_email]);
    await client.query(`INSERT INTO transactions(user_email, type, montant_eur, note) VALUES ($1, 'adjust', $2, $3)`, [user_email, d, note]);
    await client.query('COMMIT');

    await logSecurity({ email: req.user.email, event: 'admin_adjust_balance', severity: 'warn', ip: req.ip, details: { user: user_email, delta: d, note } });
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

/* =================================================================== */
/* SETTINGS, ADS, NEWS, CONTACT, PROPOSITIONS                          */
/* =================================================================== */
router.get('/company-settings', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM company_settings WHERE key NOT IN ('openai_key','deepseek_key','anthropic_key','theodds_key','active_ai_provider')`);
    res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/company-settings', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(req.body || {})) {
      await client.query(
        `INSERT INTO company_settings(key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

/* ⭐ v6.2.2 : GET /api-keys renvoie les clés MASQUÉES */
router.get('/api-keys', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT key, value FROM company_settings WHERE key IN ('openai_key','deepseek_key','anthropic_key','theodds_key','active_ai_provider')`);
    const out = {};
    rows.forEach(r => { out[r.key] = r.value; });

    // ⭐ FALLBACK .ENV : Si la BDD est vide, on affiche ce qu'il y a dans le .env
    if (!out.openai_key && process.env.OPENAI_API_KEY) out.openai_key = process.env.OPENAI_API_KEY;
    if (!out.deepseek_key && process.env.DEEPSEEK_API_KEY) out.deepseek_key = process.env.DEEPSEEK_API_KEY;
    if (!out.anthropic_key && process.env.ANTHROPIC_API_KEY) out.anthropic_key = process.env.ANTHROPIC_API_KEY;
    if (!out.theodds_key && process.env.THEODDS_KEY) out.theodds_key = process.env.THEODDS_KEY;
    if (!out.active_ai_provider && process.env.ACTIVE_AI_PROVIDER) out.active_ai_provider = process.env.ACTIVE_AI_PROVIDER;

    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ⭐ v6.2.2 : POST /api-keys ignore les valeurs masquées (pas de réécriture) */
router.post('/api-keys', async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    console.log("Reçu du frontend :", body); // ⭐ Log de débogage
    
    const allowedKeys = ['openai_key', 'deepseek_key', 'anthropic_key', 'theodds_key', 'active_ai_provider'];
    let keyChanged = false;
    
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(body)) {
      if (!allowedKeys.includes(key)) continue;
      if (key === 'theodds_key') keyChanged = true;
      
      await client.query(
        `INSERT INTO company_settings(key, value, updated_at) VALUES ($1, $2, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, 
        [key, String(value ?? '').trim()]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    console.error("[API-KEYS ERROR]", e); // ⭐ Log de l'erreur réelle
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.get('/ads', async (_req, res) => {
  try { res.json((await pool.query(`SELECT * FROM ads ORDER BY id DESC`)).rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/ads', async (req, res) => {
  try {
    const { titre, contenu, image_url, slot, target_url, cta_text, bg_color, text_color } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO ads(titre, contenu, image_url, slot, target_url, cta_text, bg_color, text_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [titre, contenu, image_url, slot || 'header_banner', target_url, cta_text || 'Decouvrir', bg_color || '#7c3aed', text_color || '#ffffff']);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/ads/:id', async (req, res) => {
  try { await pool.query(`DELETE FROM ads WHERE id = $1`, [req.params.id]); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/news', async (_req, res) => {
  try { res.json((await pool.query(`SELECT * FROM news ORDER BY date DESC`)).rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/news', async (req, res) => {
  try {
    const { titre, contenu, image_url } = req.body || {};
    const { rows } = await pool.query(
      `INSERT INTO news(titre, contenu, image_url, publie) VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [titre, contenu, image_url || null]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/news/:id', async (req, res) => {
  try { await pool.query(`DELETE FROM news WHERE id = $1`, [req.params.id]); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/contact-messages', async (_req, res) => {
  try { res.json((await pool.query(`SELECT * FROM contact_messages ORDER BY date DESC`)).rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/contact-messages/:id', async (req, res) => {
  try { await pool.query(`UPDATE contact_messages SET lu = TRUE WHERE id = $1`, [req.params.id]); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/propositions', async (_req, res) => {
  try { res.json((await pool.query(`SELECT * FROM propositions ORDER BY date DESC`)).rows); } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/propositions', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_email, data, toAll } = req.body || {};
    await client.query('BEGIN');
    const targets = toAll
      ? (await client.query(`SELECT email FROM users WHERE role = 'user'`)).rows.map(r => r.email)
      : [user_email];
    for (const em of targets) {
      await client.query(`INSERT INTO propositions(admin_email, user_email, data) VALUES ($1, $2, $3)`, [req.user.email, em, data]);
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, count: targets.length });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

/* =================================================================== */
/* RESET                                                               */
/* =================================================================== */
/* ⭐ v6.2.2 : log AVANT le reset (sinon perdu) + confirmation double */
router.post('/reset-data', async (req, res) => {
  const client = await pool.connect();
  try {
    const { confirm } = req.body || {};
    if (confirm !== 'RESET') return res.status(400).json({ error: 'Tapez "RESET" pour confirmer' });

    logger.warn(`[admin/reset-data] Demandé par ${req.user.email} (${req.ip}) — exécution imminente`);
    await logSecurity({ email: req.user.email, event: 'admin_reset_data_intent', severity: 'critical', ip: req.ip });

    await client.query('BEGIN');
    await client.query(`SELECT reset_application_data()`);
    await client.query('COMMIT');

    res.json({ ok: true, message: 'Donnees reinitialisees.' });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;